'use strict';

const { STAFF_ROLES } = require('./constants');

// In-memory map: uid -> Set<{ res, role }>
const clients = new Map();

let _eventIdCounter = Date.now();
function nextEventId() { return String(++_eventIdCounter); }

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

// ─── Public broadcast (Redis-aware) ──────────────────────────────────────────

function broadcastToAll(event, data) {
  if (_redisPublish) {
    _redisPublish(event, data);
  } else {
    localBroadcastToAll(event, data);
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

module.exports = {
  clients,
  addClient, removeClient,
  broadcastRequestUpdate,
  broadcastChatMessage, broadcastChatUpdate, broadcastChatDelete,
  setRedisPublish,
  localBroadcastToAll,
  localBroadcastRequestUpdate,
};
