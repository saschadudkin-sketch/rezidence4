'use strict';

const path = require('path');
const logger = require('../logger');
const requireAuth = require('../middleware/auth');
const { canUserAccessUpload } = require('../services/uploadAccess');
const {
  verifySignedUploadQuery,
  auditUploadAccess,
  getSignedUploadPropertySlug,
} = require('../services/uploadSecurity');
const {
  resolveProperty,
  getProperty,
  getPropertyPool,
} = require('../middleware/propertyDb');

function attachUploadProperty(req, property, resolvedBy) {
  req.propertySlug = property.slug;
  req.property = property;
  req.propertyResolvedBy = resolvedBy;
  req.db = getPropertyPool(property);
}

async function resolveUploadTenant(req, signedTenantSlug = null) {
  if (signedTenantSlug) {
    const property = await getProperty(signedTenantSlug);
    if (!property) return { errorStatus: 404, body: { error: 'Property not found' } };
    if (!property.is_active) return { errorStatus: 503, body: { error: 'Property unavailable' } };
    attachUploadProperty(req, property, 'signed_url');
    return { queryDb: req.db };
  }

  const ctx = await resolveProperty(req);
  if (ctx.error === 'cross_tenant') {
    return { errorStatus: 403, body: { error: 'Cross-tenant access denied' } };
  }
  if (!ctx.property) return { queryDb: null };
  if (!ctx.property.is_active) return { errorStatus: 503, body: { error: 'Property unavailable' } };
  attachUploadProperty(req, ctx.property, ctx.resolvedBy);
  return { queryDb: req.db };
}

function createTryAuthForUpload() {
  return async function tryAuthForUpload(req, res) {
    let nextCalled = false;
    await requireAuth(req, res, () => { nextCalled = true; });
    if (nextCalled) return req.user || null;
    return null;
  };
}

function registerProtectedUploads(app, { uploadDir }) {
  const tryAuthForUpload = createTryAuthForUpload();

  app.get('/uploads/:filename', async (req, res) => {
    const filename = path.basename(req.params.filename);
    const filepath = path.join(uploadDir, filename);

    if (!filepath.startsWith(uploadDir + path.sep) && filepath !== uploadDir) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const signedAllowed = verifySignedUploadQuery(filename, req.query);
    const tenantResolution = await resolveUploadTenant(
      req,
      signedAllowed ? getSignedUploadPropertySlug(req.query) : null,
    );
    if (tenantResolution.errorStatus) {
      return res.status(tenantResolution.errorStatus).json(tenantResolution.body);
    }
    const queryDb = tenantResolution.queryDb || req.db;
    let user = null;
    const accessVia = signedAllowed ? 'signed_url' : 'auth';

    if (!signedAllowed) {
      user = await tryAuthForUpload(req, res);
      if (!user) {
        await auditUploadAccess({ filename, decision: 'deny', reason: 'unauthenticated', via: 'auth', req, queryDb }).catch(() => {});
        if (!res.headersSent) return res.status(401).json({ error: 'No token' });
        return;
      }
      try {
        const allowed = await canUserAccessUpload(user, filename, queryDb);
        if (!allowed) {
          await auditUploadAccess({ filename, uid: user.uid, decision: 'deny', reason: 'acl_forbidden', via: 'auth', req, queryDb }).catch(() => {});
          return res.status(403).json({ error: 'Forbidden' });
        }
      } catch (err) {
        logger.error({ err, uid: user?.uid, filename }, '[uploads] ACL check failed');
        await auditUploadAccess({ filename, uid: user?.uid, decision: 'deny', reason: 'acl_check_failed', via: 'auth', req, queryDb }).catch(() => {});
        return res.status(500).json({ error: 'Access check failed' });
      }
    }

    const ext = path.extname(filename).toLowerCase();
    const safeInlineExts = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);
    if (safeInlineExts.has(ext)) {
      const mimeMap = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.avif': 'image/avif',
      };
      res.setHeader('Content-Type', mimeMap[ext] || 'image/jpeg');
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    } else {
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    await auditUploadAccess({
      filename,
      uid: user?.uid,
      decision: 'allow',
      reason: signedAllowed ? 'signed_url_valid' : 'acl_allowed',
      via: accessVia,
      req,
      queryDb,
    }).catch(() => {});

    res.sendFile(filepath, (err) => {
      if (err) {
        if (err.code === 'ENOENT') return res.status(404).json({ error: 'Not found' });
        return res.status(500).json({ error: 'File error' });
      }
    });
  });
}

module.exports = {
  registerProtectedUploads,
};
