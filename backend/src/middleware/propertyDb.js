'use strict';

const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const { getPlatformDb } = require('../db');
const { resolveFlags } = require('../config/featureFlags');
const logger = require('../logger');

// Property connection pool cache - one pool per property slug
const pools = new Map(); // slug -> pg.Pool
const propertyCache = new Map(); // slug -> {property, cachedAt}
const hostnameCache = new Map(); // hostname -> {property, cachedAt}
const CACHE_TTL_MS = 60_000; // 60 seconds

// ─── Hybrid tenant resolver ───────────────────────────────────────────────────
//
// Three sources of tenant identity, from most-trusted to least-trusted:
//
//   1. HOSTNAME (Host header → properties.hostname).  Set by DNS/reverse
//      proxy, not by the client, so it survives hostile JWT swaps.  This is
//      the production path for domhub.su subdomains and custom domains.
//
//   2. X-PROPERTY-SLUG header.  Used by local dev tooling, mobile clients
//      before they know their subdomain, and service-to-service calls.
//
//   3. Public content path slug.  Only for /public/:slug/(documents|announcements),
//      so kiosk/read-only content can resolve its tenant before route matching.
//      For those endpoints the path slug is authoritative: if it is unknown,
//      we do not fall back to a browser JWT from another tenant.
//
//   4. JWT property_slug claim.  Baked into the access token at login so
//      the tenant survives even when hostname/header are absent (CLI utils,
//      background jobs reusing an API token).
//
// Consistency guard: whenever the JWT advertises a slug that disagrees with
// the tenant resolved from hostname/header, we refuse service (403).  This
// prevents a stolen / replayed token from one tenant being used against a
// different tenant's subdomain.

/**
 * Normalise a Host header (strip port, lowercase, trim) for storage-matching.
 * Returns null for empty input.
 */
function normalizeHostname(raw) {
  if (!raw) return null;
  const h = String(raw).split(':')[0].trim().toLowerCase();
  return h || null;
}

/** Extract the request hostname (Host header) or null. */
function extractHostname(req) {
  return normalizeHostname(req.headers?.host);
}

/** Extract the X-Property-Slug header (lower-cased) or null. */
function extractHeaderSlug(req) {
  const h = req.headers?.['x-property-slug'];
  if (!h) return null;
  const s = String(h).trim().toLowerCase();
  return s || null;
}

/** Extract the path slug for public content endpoints mounted behind /api/v1. */
function extractPublicPathSlug(req) {
  const rawPath = String(req.path || req.url || req.originalUrl || '').split('?')[0];
  const path = rawPath.replace(/^\/api\/v1(?=\/)/, '');
  const match = path.match(/^\/public\/([^/]+)\/(?:announcements|documents)(?:\/|$)/);
  if (!match) return null;
  try {
    const slug = decodeURIComponent(match[1]).trim().toLowerCase();
    return slug || null;
  } catch {
    return null;
  }
}

/**
 * Extract property_slug claim from a JWT carried by either the Authorization
 * header (Bearer) or the httpOnly `token` cookie used by the browser SPA.
 * Returns null on any decode failure — auth middleware is responsible for
 * rejecting malformed tokens, we only care about the claim.
 */
function extractJwtSlug(req) {
  const pickFromToken = (raw) => {
    try {
      const decoded = jwt.decode(raw);
      const slug = decoded?.property_slug;
      return slug ? String(slug).toLowerCase() : null;
    } catch {
      return null;
    }
  };

  const authHeader = req.headers?.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const slug = pickFromToken(authHeader.slice(7));
    if (slug) return slug;
  }

  const cookieToken = req.cookies?.token;
  if (cookieToken) {
    const slug = pickFromToken(cookieToken);
    if (slug) return slug;
  }

  return null;
}

/**
 * LEGACY helper — kept for backwards compatibility with callers that only
 * need the slug string.  Prefer `resolveProperty()` which understands the
 * full hostname+header+JWT hierarchy.
 */
function extractPropertySlug(req) {
  const headerSlug = extractHeaderSlug(req);
  if (headerSlug) return headerSlug;
  return extractJwtSlug(req);
}

/**
 * Retrieves property from platform DB with in-memory caching
 */
async function getProperty(slug) {
  if (!slug) return null;

  // Check cache first
  const cached = propertyCache.get(slug);
  if (cached && (Date.now() - cached.cachedAt) < CACHE_TTL_MS) {
    return cached.property;
  }

  // Query platform DB
  try {
    const platformDb = getPlatformDb();
    const { rows } = await platformDb.query(
      'SELECT * FROM properties WHERE slug = $1',
      [slug]
    );

    const property = rows[0] || null;

    // Cache result (including null results to avoid repeated queries for invalid slugs)
    propertyCache.set(slug, {
      property,
      cachedAt: Date.now()
    });
    // Mirror into the hostname cache so a later hostname-based lookup
    // for the same tenant is free.
    if (property && property.hostname) {
      hostnameCache.set(property.hostname, { property, cachedAt: Date.now() });
    }

    return property;
  } catch (err) {
    logger.error({ err, slug }, '[propertyDb] failed to fetch property from platform DB');
    return null;
  }
}

/**
 * Retrieves property by hostname (Host header) with in-memory caching.
 * Matches properties.hostname exactly (lowercased).  Returns null when no
 * tenant claims this hostname — caller should fall back to header/JWT.
 */
async function getPropertyByHostname(hostname) {
  if (!hostname) return null;

  // AUDIT #10: Host header не доверенный источник — express берёт его as-is
  // из req.headers.host, и с `trust proxy=1` клиент может послать любой Host.
  // PLATFORM_ALLOWED_HOSTNAME_SUFFIX задаёт белый список доменных суффиксов
  // (напр. "domhub.app") — остальные hostname отбрасываются до похода в БД,
  // чтобы вредоносный Host не замусорил hostnameCache и не попал в запрос
  // SELECT * FROM properties (DoS через кэш-заливку).
  //   • Если env НЕ задана → валидация выключена (dev / legacy).
  //   • Кастомные домены (residence.example.com) добавить via PLATFORM_ALLOWED_HOSTNAMES
  //     future-work — сейчас первый tenant на поддомене домена платформы.
  const allowedSuffix = process.env.PLATFORM_ALLOWED_HOSTNAME_SUFFIX;
  if (allowedSuffix) {
    const ok = hostname === allowedSuffix || hostname.endsWith(`.${allowedSuffix}`);
    if (!ok) {
      logger.warn({ hostname, allowedSuffix }, '[propertyDb] hostname outside allowed suffix');
      return null;
    }
  }

  const cached = hostnameCache.get(hostname);
  if (cached && (Date.now() - cached.cachedAt) < CACHE_TTL_MS) {
    return cached.property;
  }

  try {
    const platformDb = getPlatformDb();
    const { rows } = await platformDb.query(
      'SELECT * FROM properties WHERE hostname = $1',
      [hostname]
    );
    const property = rows[0] || null;

    hostnameCache.set(hostname, { property, cachedAt: Date.now() });
    // Mirror into the slug cache too — same row, two lookup keys.
    if (property) {
      propertyCache.set(property.slug, { property, cachedAt: Date.now() });
    }
    return property;
  } catch (err) {
    logger.error({ err, hostname }, '[propertyDb] failed to fetch property by hostname');
    return null;
  }
}

/**
 * Hybrid tenant resolver.  Walks the hostname → header → JWT chain and
 * returns the first matching active property, along with metadata about
 * which source won.
 *
 * Result shape:
 *   {
 *     property:    Property | null,
 *     resolvedBy:  'hostname' | 'header' | 'jwt' | null,
 *     sources:     { hostname, headerSlug, jwtSlug },
 *     error:       null | 'cross_tenant',
 *   }
 *
 * `error === 'cross_tenant'` means the JWT carried a slug that disagrees
 * with the hostname/header resolution.  Callers (middleware) surface this
 * as 403 — we do NOT silently trust the JWT in that case, because it lets
 * a token from tenant A get replayed against tenant B's API surface.
 */
async function resolveProperty(req) {
  const hostname = extractHostname(req);
  const headerSlug = extractHeaderSlug(req);
  const pathSlug = extractPublicPathSlug(req);
  const jwtSlug = extractJwtSlug(req);
  const sources = { hostname, headerSlug, pathSlug, jwtSlug };

  let property = null;
  let resolvedBy = null;

  if (hostname) {
    const byHost = await getPropertyByHostname(hostname);
    if (byHost) {
      property = byHost;
      resolvedBy = 'hostname';
    }
  }

  if (!property && headerSlug) {
    const bySlug = await getProperty(headerSlug);
    if (bySlug) {
      property = bySlug;
      resolvedBy = 'header';
    }
  }

  if (pathSlug) {
    if (property && property.slug !== pathSlug) {
      return { property: null, resolvedBy: null, sources, error: 'cross_tenant' };
    }
    const bySlug = await getProperty(pathSlug);
    if (!bySlug) return { property: null, resolvedBy: null, sources, error: null };
    property = bySlug;
    resolvedBy = 'path';
  }

  if (!property && jwtSlug) {
    const bySlug = await getProperty(jwtSlug);
    if (bySlug) {
      property = bySlug;
      resolvedBy = 'jwt';
    }
  }

  // Cross-tenant replay guard: we already trusted hostname/header to pick
  // `property`, so a JWT that disagrees is either stale (user switched
  // tenants without re-logging in) or malicious (replay).  Either way we
  // refuse — the request has to be re-issued with a matching token.
  if (property && jwtSlug && jwtSlug !== property.slug) {
    return { property: null, resolvedBy: null, sources, error: 'cross_tenant' };
  }

  return { property, resolvedBy, sources, error: null };
}

/**
 * Gets or creates a connection pool for a property
 */
function getPropertyPool(property) {
  const { slug, db_connection_url } = property;

  if (!pools.has(slug)) {
    const pool = new Pool({
      connectionString: db_connection_url,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 10_000,
    });

    pool.on('error', (err) => {
      logger.error({ err, slug }, '[propertyDb] unexpected property pool error');
    });

    pools.set(slug, pool);
    logger.info({ slug }, '[propertyDb] created new property connection pool');
  }

  return pools.get(slug);
}

/**
 * Middleware that resolves property context and attaches property-specific DB pool
 */
async function propertyDbMiddleware(req, res, next) {
  try {
    const ctx = await resolveProperty(req);

    // Cross-tenant JWT replay — refuse before any property-scoped code runs.
    if (ctx.error === 'cross_tenant') {
      logger.warn(
        { sources: ctx.sources },
        '[propertyDb] cross-tenant attempt: tenant sources disagree',
      );
      return res.status(403).json({
        error: 'Cross-tenant access denied',
        message: 'Resolved tenant sources do not match',
      });
    }

    if (!ctx.property) {
      // Distinguish "request names a tenant we don't know" from "request
      // carries no tenant context at all" — ops visibility.
      const slugCandidate = ctx.sources.headerSlug || ctx.sources.pathSlug || ctx.sources.jwtSlug;
      if (slugCandidate) {
        logger.warn({ slug: slugCandidate, hostname: ctx.sources.hostname }, '[propertyDb] property not found');
        return res.status(404).json({
          error: 'Property not found',
          message: `Property '${slugCandidate}' does not exist`,
        });
      }
      return res.status(400).json({
        error: 'Property context required',
        message: 'Request must include X-Property-Slug header or valid JWT with property_slug claim',
      });
    }

    if (!ctx.property.is_active) {
      logger.warn({ slug: ctx.property.slug }, '[propertyDb] property is disabled');
      return res.status(503).json({
        error: 'Property unavailable',
        message: `Property '${ctx.property.slug}' is temporarily unavailable`,
      });
    }

    // Attach property info and database pool to request
    req.propertySlug = ctx.property.slug;
    req.property = ctx.property;
    req.property.resolvedFlags = resolveFlags(ctx.property.feature_flags, ctx.property.plan);
    req.propertyResolvedBy = ctx.resolvedBy;
    req.db = getPropertyPool(ctx.property);

    // Add property context to logger for this request
    req.log = logger.child({ property_slug: ctx.property.slug, resolved_by: ctx.resolvedBy });

    next();
  } catch (err) {
    logger.error({ err }, '[propertyDb] middleware error');
    return res.status(500).json({
      error: 'Property context error',
      message: 'Failed to resolve property context',
    });
  }
}

/**
 * Evict a single property from the in-memory cache.
 * Call this after updating feature_flags (or any property field) so the next
 * request re-fetches the fresh row from the platform DB.
 *
 * @param {string} slug
 */
function invalidatePropertyCache(slug) {
  const cached = propertyCache.get(slug);
  propertyCache.delete(slug);
  // Drop any hostname entry pointing at the same row so a renamed hostname
  // doesn't keep resolving through the stale mapping.
  if (cached?.property?.hostname) {
    hostnameCache.delete(cached.property.hostname);
  }
}

/**
 * Gracefully close all property connection pools
 */
async function closeAllPools() {
  const promises = [];
  for (const [slug, pool] of pools.entries()) {
    promises.push(
      pool.end().catch(err =>
        logger.error({ err, slug }, '[propertyDb] error closing pool')
      )
    );
  }

  await Promise.allSettled(promises);
  pools.clear();
  propertyCache.clear();
  hostnameCache.clear();
  logger.info('[propertyDb] all property pools closed');
}

module.exports = {
  propertyDbMiddleware,
  closeAllPools,
  extractPropertySlug,
  extractHostname,
  extractHeaderSlug,
  extractPublicPathSlug,
  extractJwtSlug,
  getProperty,
  getPropertyByHostname,
  getPropertyPool,
  resolveProperty,
  invalidatePropertyCache,
  // Export for testing
  _pools: pools,
  _cache: propertyCache,
  _hostnameCache: hostnameCache,
};
