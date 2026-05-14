'use strict';

/**
 * SCALABILITY NOTE (МАСШТАБ-1): SSE connections are stored in process memory.
 * In a multi-instance deployment (horizontal scaling), events emitted on instance A
 * are NOT received by clients connected to instance B.
 *
 * To support multi-instance horizontal scaling:
 * 1. Subscribe each instance to a Redis Pub/Sub channel on startup
 * 2. When any event is emitted (request approved, chat message, etc.),
 *    publish it to Redis instead of broadcasting locally
 * 3. Each instance receives the Redis message and broadcasts to its own SSE clients
 *
 * TODO: Implement Redis Pub/Sub for multi-instance SSE broadcast.
 * Reference: https://redis.io/docs/latest/develop/interact/pubsub/
 * Estimated effort: 2–3 days.
 */

const { STAFF_ROLES } = require('./constants');
const { randomUUID } = require('crypto');

// In-memory map: uid -> Set<{ res, role, propertySlug }>
const clients = new Map();

// Roles allowed to receive blacklist events
const BLACKLIST_ROLES = new Set(['admin', 'security', 'concierge']);
const ACCESS_EVENT_ROLES = new Set([
  'admin',
  'property_admin',
  'management_company_admin',
  'platform_admin',
  'security',
  'concierge',
  'staff',
]);

function nextEventId() {
  return `${Date.now()}-${randomUUID()}`;
}

const MAX_CONNECTIONS_PER_USER = 5;
const MAX_TOTAL_CONNECTIONS = 2000;

function getTotalConnections() {
  let total = 0;
  for (const set of clients.values()) total += set.size;
  return total;
}

function normalizeTenantContext(input) {
  if (!input) return null;
  if (typeof input === 'string') return input.trim().toLowerCase() || null;
  const slug = input.propertySlug || input.property_slug || input.slug || input.property?.slug;
  return slug ? String(slug).trim().toLowerCase() : null;
}

function eventTenant(data, options = {}) {
  return normalizeTenantContext(options)
    || normalizeTenantContext(data)
    || normalizeTenantContext(data?.property);
}

function withTenantData(data, tenant) {
  if (!tenant || !data || typeof data !== 'object' || Array.isArray(data)) return data;
  if (data.property_slug === tenant || data.propertySlug === tenant) return data;
  return { ...data, property_slug: tenant };
}

function tenantMatches(entry, tenant) {
  if (!tenant) return !entry.propertySlug;
  return entry.propertySlug === tenant;
}

function addClient(uid, res, role, tenantContext = null) {
  if (getTotalConnections() >= MAX_TOTAL_CONNECTIONS) {
    try { res.status(503).end(); } catch { /* already closed */ }
    return;
  }
  if (!clients.has(uid)) clients.set(uid, new Set());
  const set = clients.get(uid);
  if (set.size >= MAX_CONNECTIONS_PER_USER) {
    const first = set.values().next().value;
    try { first.res.end(); } catch { /* уже закрыто */ }
    set.delete(first);
  }
  set.add({ res, role, propertySlug: normalizeTenantContext(tenantContext) });
}

function removeClient(uid, res) {
  const set = clients.get(uid);
  if (!set) return;
  for (const entry of set) {
    if (entry.res === res) { set.delete(entry); break; }
  }
  if (!set.size) clients.delete(uid);
}

// ─── FIX [AUDIT-6]: Redis pub/sub hook ───────────────────────────────────────
let _redisPublish = null;
// fn signature: (event, data, targetRoles?) where targetRoles is Set|undefined
function setRedisPublish(fn) { _redisPublish = fn; }

// ─── Local broadcast (вызывается напрямую ИЛИ из Redis subscriber) ───────────

function localBroadcastToAll(event, data, options = {}) {
  const tenant = eventTenant(data, options);
  const scopedData = withTenantData(data, tenant);
  const id = nextEventId();
  const payload = `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(scopedData)}\n\n`;
  for (const set of clients.values()) {
    for (const entry of set) {
      if (!tenantMatches(entry, tenant)) continue;
      const { res } = entry;
      try { res.write(payload); } catch { /* disconnected */ }
    }
  }
}

function localBroadcastRequestUpdate(req, options = {}) {
  const tenant = eventTenant(req, options);
  const scopedReq = withTenantData(req, tenant);
  const id = nextEventId();
  const payload = `id: ${id}\nevent: request_update\ndata: ${JSON.stringify(scopedReq)}\n\n`;
  for (const [uid, set] of clients.entries()) {
    for (const entry of set) {
      if (!tenantMatches(entry, tenant)) continue;
      const { res, role } = entry;
      if (STAFF_ROLES.has(role) || scopedReq.createdByUid === uid) {
        try { res.write(payload); } catch { /* disconnected */ }
      }
    }
  }
}

// ─── Local broadcast: only to clients with specific roles ─────────────────────
// Used directly OR from Redis subscriber when targetRoles is set.
function localBroadcastToRoles(event, data, allowedRoles, options = {}) {
  const tenant = eventTenant(data, options);
  const scopedData = withTenantData(data, tenant);
  const id = nextEventId();
  const payload = `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(scopedData)}\n\n`;
  for (const [, set] of clients.entries()) {
    for (const entry of set) {
      if (!tenantMatches(entry, tenant)) continue;
      const { res, role } = entry;
      if (allowedRoles.has(role)) {
        try { res.write(payload); } catch { /* disconnected */ }
      }
    }
  }
}

// ─── Public broadcast (Redis-aware) ──────────────────────────────────────────

function broadcastToAll(event, data, options = {}) {
  const tenant = eventTenant(data, options);
  const scopedData = withTenantData(data, tenant);
  if (_redisPublish) {
    _redisPublish(event, scopedData, undefined, tenant);
  } else {
    localBroadcastToAll(event, scopedData, { propertySlug: tenant });
  }
}

// Broadcast to specific roles only (Redis-aware).
// targetRoles must be a Set<string>.
function broadcastToRoles(event, data, targetRoles, options = {}) {
  const tenant = eventTenant(data, options);
  const scopedData = withTenantData(data, tenant);
  if (_redisPublish) {
    // Pass roles array so Redis subscriber can re-filter per instance
    _redisPublish(event, scopedData, [...targetRoles], tenant);
  } else {
    localBroadcastToRoles(event, scopedData, targetRoles, { propertySlug: tenant });
  }
}

function broadcastRequestUpdate(req, options = {}) {
  const tenant = eventTenant(req, options);
  const scopedReq = withTenantData(req, tenant);
  if (_redisPublish) {
    _redisPublish('request_update', scopedReq, undefined, tenant);
  } else {
    localBroadcastRequestUpdate(scopedReq, { propertySlug: tenant });
  }
}

function broadcastChatMessage(msg, options) { broadcastToAll('message',        msg, options); }
function broadcastChatUpdate(msg, options)  { broadcastToAll('message_update', msg, options); }
function broadcastChatDelete(id, options)   { broadcastToAll('message_delete', { id }, options); }

// ─── Domain-specific broadcasts ──────────────────────────────────────────────
// Blacklist: only admin/security/concierge may see blacklist data
function broadcastBlacklistAdd(entry, options)  { broadcastToRoles('blacklist_add',    entry,    BLACKLIST_ROLES, options); }
function broadcastBlacklistRemove(id, options)  { broadcastToRoles('blacklist_remove', { id },   BLACKLIST_ROLES, options); }
function broadcastAccessEvent(data, options)   { broadcastToRoles('access_event', data, ACCESS_EVENT_ROLES, options); }
// User updates: all clients already receive full user list at sync,
// so broadcasting to all is consistent with existing data access model.
function broadcastUserUpdate(user, options)     { broadcastToAll('user_update', user, options); }
function broadcastUserDelete(uid, options)      { broadcastToAll('user_delete', { uid }, options); }

/**
 * closeAll — send retry hint to all SSE clients and close their connections.
 * Called during graceful shutdown so browsers reconnect after restart.
 */
function closeAll() {
  for (const set of clients.values()) {
    for (const { res } of set) {
      try { res.write('retry: 2000\n\n'); res.end(); } catch { /* already closed */ }
    }
  }
  clients.clear();
}

module.exports = {
  clients,
  addClient, removeClient,
  closeAll,
  broadcastRequestUpdate,
  broadcastChatMessage, broadcastChatUpdate, broadcastChatDelete,
  broadcastBlacklistAdd, broadcastBlacklistRemove,
  broadcastAccessEvent,
  broadcastUserUpdate, broadcastUserDelete,
  setRedisPublish,
  localBroadcastToAll, localBroadcastToRoles,
  localBroadcastRequestUpdate,
  normalizeTenantContext,
};
