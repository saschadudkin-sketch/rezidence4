'use strict';

const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const { getPlatformDb } = require('../db');
const { resolveFlags } = require('../config/featureFlags');
const logger = require('../logger');

// Property connection pool cache - one pool per property slug
const pools = new Map(); // slug -> pg.Pool
const propertyCache = new Map(); // slug -> {property, cachedAt}
const CACHE_TTL_MS = 60_000; // 60 seconds

/**
 * Extracts property slug from request headers or JWT token
 */
function extractPropertySlug(req) {
  // First try X-Property-Slug header
  const headerSlug = req.headers['x-property-slug'];
  if (headerSlug) {
    return headerSlug;
  }

  // Fall back to JWT property_slug claim
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.slice(7);
      const decoded = jwt.decode(token); // Just decode, don't verify (auth middleware handles verification)
      return decoded?.property_slug ?? null;
    } catch (err) {
      // Ignore JWT decode errors - auth middleware will handle invalid tokens
    }
  }

  return null;
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

    return property;
  } catch (err) {
    logger.error({ err, slug }, '[propertyDb] failed to fetch property from platform DB');
    return null;
  }
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
  const slug = extractPropertySlug(req);

  if (!slug) {
    return res.status(400).json({
      error: 'Property context required',
      message: 'Request must include X-Property-Slug header or valid JWT with property_slug claim'
    });
  }

  // Add property slug to request context for logging
  req.propertySlug = slug;

  try {
    const property = await getProperty(slug);

    if (!property) {
      logger.warn({ slug }, '[propertyDb] property not found');
      return res.status(404).json({
        error: 'Property not found',
        message: `Property '${slug}' does not exist`
      });
    }

    if (!property.is_active) {
      logger.warn({ slug }, '[propertyDb] property is disabled');
      return res.status(503).json({
        error: 'Property unavailable',
        message: `Property '${slug}' is temporarily unavailable`
      });
    }

    // Attach property info and database pool to request
    req.property = property;
    req.property.resolvedFlags = resolveFlags(property.feature_flags);
    req.db = getPropertyPool(property);

    // Add property context to logger for this request
    req.log = logger.child({ property_slug: slug });

    next();
  } catch (err) {
    logger.error({ err, slug }, '[propertyDb] middleware error');
    return res.status(500).json({
      error: 'Property context error',
      message: 'Failed to resolve property context'
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
  propertyCache.delete(slug);
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
  logger.info('[propertyDb] all property pools closed');
}

module.exports = {
  propertyDbMiddleware,
  closeAllPools,
  extractPropertySlug,
  getProperty,
  invalidatePropertyCache,
  // Export for testing
  _pools: pools,
  _cache: propertyCache,
};