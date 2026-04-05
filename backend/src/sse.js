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

// In-memory map: uid -> Set<{ res, role }>
const clients = new Map();

// Roles allowed to receive blacklist events
const BLACKLIST_ROLES = new Set(['admin', 'security', 'concierge']);

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

function addClient(uid, res, role) {
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
  set.add({ res, role });
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

function localBroadcastToAll(event, data) {
  const id = nextEventId();
  const payload = `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const set of clients.values()) {
    for (const { res } of set) {
      try { res.write(payload); } catch { /* disconnected */ }
    }
  }
}

function localBroadcastRequestUpdate(req) {
  const id = nextEventId();
  const payload = `id: ${id}\nevent: request_update\ndata: ${JSON.stringify(req)}\n\n`;
  for (const [uid, set] of clients.entries()) {
    for (const { res, role } of set) {
      if (STAFF_ROLES.has(role) || req.createdByUid === uid) {
        try { res.write(payload); } catch { /* disconnected */ }
      }
    }
  }
}

// ─── Local broadcast: only to clients with specific roles ─────────────────────
// Used directly OR from Redis subscriber when targetRoles is set.
function localBroadcastToRoles(event, data, allowedRoles) {
  const id = nextEventId();
  const payload = `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [, set] of clients.entries()) {
    for (const { res, role } of set) {
      if (allowedRoles.has(role)) {
        try { res.write(payload); } catch { /* disconnected */ }
      }
    }
  }
}

// ─── Public broadcast (Redis-aware) ──────────────────────────────────────────

function broadcastToAll(event, data) {
  if (_redisPublish) {
    _redisPublish(event, data);
  } else {
    localBroadcastToAll(event, data);
  }
}

// Broadcast to specific roles only (Redis-aware).
// targetRoles must be a Set<string>.
function broadcastToRoles(event, data, targetRoles) {
  if (_redisPublish) {
    // Pass roles array so Redis subscriber can re-filter per instance
    _redisPublish(event, data, [...targetRoles]);
  } else {
    localBroadcastToRoles(event, data, targetRoles);
  }
}

function broadcastRequestUpdate(req) {
  if (_redisPublish) {
    _redisPublish('request_update', req);
  } else {
    localBroadcastRequestUpdate(req);
  }
}

function broadcastChatMessage(msg) { broadcastToAll('message',        msg); }
function broadcastChatUpdate(msg)  { broadcastToAll('message_update', msg); }
function broadcastChatDelete(id)   { broadcastToAll('message_delete', { id }); }

// ─── Domain-specific broadcasts ──────────────────────────────────────────────
// Blacklist: only admin/security/concierge may see blacklist data
function broadcastBlacklistAdd(entry)  { broadcastToRoles('blacklist_add',    entry,    BLACKLIST_ROLES); }
function broadcastBlacklistRemove(id)  { broadcastToRoles('blacklist_remove', { id },   BLACKLIST_ROLES); }
// User updates: all clients already receive full user list at sync,
// so broadcasting to all is consistent with existing data access model.
function broadcastUserUpdate(user)     { broadcastToAll('user_update', user); }
function broadcastUserDelete(uid)      { broadcastToAll('user_delete', { uid }); }

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
  broadcastUserUpdate, broadcastUserDelete,
  setRedisPublish,
  localBroadcastToAll, localBroadcastToRoles,
  localBroadcastRequestUpdate,
};
