'use strict';

/**
 * Phase 5 (platform-v1) — announcements_v2 service unit tests.
 * Spec: docs/product/specs/platform-v1/announcements-v2-spec.md §3-§5.
 *
 * Pattern: мокаем только db / pool / client интерфейсы.  enqueueNotificationBatch
 * НЕ мокаем — он делает tx.query(), и мы проверяем end-to-end шейп SQL +
 * outbox INSERT в fan-out'е.
 *
 * Coverage:
 *   • constants + helpers (clampLimit, trimBodyPreview, isValidUuid)
 *   • validateCreateInput / validateAudience / validateChannels
 *   • listForResident — audience match all/building/entrance/unit_type, category
 *   • listForAdmin    — status branches (draft/scheduled/active/expired/deleted/all)
 *   • listPublic      — только emergency/maintenance + audience='all'
 *   • getById         — UUID guard
 *   • createAnnouncement  — валидация + INSERT с дефолтами
 *   • updateAnnouncement  — whitelist, draft-only, conflict detection
 *   • publishAnnouncement — FOR UPDATE, conflict, fan-out happy, scheduled no-op
 *   • unpublishAnnouncement / softDeleteAnnouncement
 *   • getReachMetrics     — audience size + outbox/log join
 *   • runScheduledFanout  — NOT EXISTS idempotency
 *   • resolveAudience per audience_type
 *   • resolve helpers (resident ctx / staff id / property by slug)
 */

const { describe, test, expect } = require('@jest/globals');

const {
  ALLOWED_CATEGORIES,
  ALLOWED_AUDIENCE_TYPES,
  ALLOWED_UNIT_TYPES,
  ALLOWED_CHANNELS,
  PUBLIC_CATEGORIES,
  ANNOUNCEMENT_EVENT,
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
  clampLimit,
  trimBodyPreview,
  isValidUuid,
  listForResident,
  listForAdmin,
  listPublic,
  getById,
  createAnnouncement,
  updateAnnouncement,
  publishAnnouncement,
  unpublishAnnouncement,
  softDeleteAnnouncement,
  getReachMetrics,
  runScheduledFanout,
  resolveResidentContextByUid,
  resolveStaffIdByUid,
  resolvePropertyIdBySlug,
} = require('../v1/services/announcements');

const UUID = '11111111-2222-3333-4444-555555555555';
const UUID2 = '22222222-2222-3333-4444-555555555555';
const UUID3 = '33333333-2222-3333-4444-555555555555';
const UUID4 = '44444444-2222-3333-4444-555555555555';

// ─── query-mock helpers ──────────────────────────────────────────────────────
function makeDb(responders = []) {
  const calls = [];
  async function query(sql, args) {
    calls.push({ sql, args });
    for (const [match, fn] of responders) {
      if (typeof match === 'string' && sql.includes(match)) return fn(sql, args);
      if (match instanceof RegExp && match.test(sql)) return fn(sql, args);
    }
    return { rows: [] };
  }
  return { query, calls };
}

function makePool(responders = []) {
  const calls = [];
  const client = {
    async query(sql, args) {
      calls.push({ sql, args });
      for (const [match, fn] of responders) {
        if (typeof match === 'string' && sql.includes(match)) return fn(sql, args);
        if (match instanceof RegExp && match.test(sql)) return fn(sql, args);
      }
      return { rows: [] };
    },
    release() {},
  };
  return {
    async connect() { return client; },
    async query(sql, args) { return client.query(sql, args); },
    get calls() { return calls; },
    _client: client,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// constants
// ══════════════════════════════════════════════════════════════════════════════

describe('constants', () => {
  test('ALLOWED_CATEGORIES matches spec §4', () => {
    expect(ALLOWED_CATEGORIES).toEqual(expect.arrayContaining([
      'general', 'maintenance', 'event', 'emergency', 'marketing',
    ]));
  });
  test('ALLOWED_AUDIENCE_TYPES matches migration CHECK', () => {
    expect(ALLOWED_AUDIENCE_TYPES).toEqual(['all', 'building', 'entrance', 'unit_type']);
  });
  test('ALLOWED_UNIT_TYPES matches residents.resident_type domain', () => {
    expect(ALLOWED_UNIT_TYPES).toEqual(['owner', 'tenant', 'family_member']);
  });
  test('ALLOWED_CHANNELS ⊆ outbox channel domain', () => {
    expect(ALLOWED_CHANNELS).toEqual(['web_push', 'sms', 'telegram', 'email']);
  });
  test('PUBLIC_CATEGORIES is subset of ALLOWED_CATEGORIES', () => {
    for (const c of PUBLIC_CATEGORIES) expect(ALLOWED_CATEGORIES).toContain(c);
    // Только emergency / maintenance — остальные считаются приватными.
    expect(PUBLIC_CATEGORIES).toEqual(['emergency', 'maintenance']);
  });
  test('ANNOUNCEMENT_EVENT = announcement.published', () => {
    expect(ANNOUNCEMENT_EVENT).toBe('announcement.published');
  });
  test('list limits', () => {
    expect(DEFAULT_LIST_LIMIT).toBe(50);
    expect(MAX_LIST_LIMIT).toBe(200);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// helpers
// ══════════════════════════════════════════════════════════════════════════════

describe('clampLimit', () => {
  test('default when no input', () => expect(clampLimit()).toBe(50));
  test('default when negative/zero/NaN', () => {
    expect(clampLimit(0)).toBe(50);
    expect(clampLimit(-3)).toBe(50);
    expect(clampLimit('abc')).toBe(50);
  });
  test('caps at MAX', () => expect(clampLimit(9999)).toBe(200));
  test('passes through normal value', () => expect(clampLimit(25)).toBe(25));
});

describe('trimBodyPreview', () => {
  test('empty string on null/undefined', () => {
    expect(trimBodyPreview(null)).toBe('');
    expect(trimBodyPreview(undefined)).toBe('');
  });
  test('slices at BODY_PREVIEW_MAX (200)', () => {
    const long = 'A'.repeat(500);
    expect(trimBodyPreview(long)).toHaveLength(200);
  });
  test('keeps short text verbatim', () => {
    expect(trimBodyPreview('hi')).toBe('hi');
  });
});

describe('isValidUuid', () => {
  test('accepts canonical UUID', () => expect(isValidUuid(UUID)).toBe(true));
  test('rejects non-uuid strings', () => {
    expect(isValidUuid('')).toBe(false);
    expect(isValidUuid('not-a-uuid')).toBe(false);
    expect(isValidUuid(null)).toBe(false);
    expect(isValidUuid(123)).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// createAnnouncement — validation covers validateCreateInput / Audience / Channels
// ══════════════════════════════════════════════════════════════════════════════

describe('createAnnouncement validation', () => {
  const baseInput = {
    propertyId: UUID,
    title: 'Лифт на ремонте',
    bodyMd: 'Detail',
  };

  test('rejects missing propertyId', async () => {
    await expect(createAnnouncement(makeDb(), { ...baseInput, propertyId: undefined }))
      .rejects.toThrow(/property_id/);
  });
  test('rejects non-UUID propertyId', async () => {
    await expect(createAnnouncement(makeDb(), { ...baseInput, propertyId: 'bad' }))
      .rejects.toThrow(/property_id/);
  });
  test('rejects empty title', async () => {
    await expect(createAnnouncement(makeDb(), { ...baseInput, title: '   ' }))
      .rejects.toThrow(/title/);
  });
  test('rejects empty body_md', async () => {
    await expect(createAnnouncement(makeDb(), { ...baseInput, bodyMd: '' }))
      .rejects.toThrow(/body_md/);
  });
  test('rejects invalid category', async () => {
    await expect(createAnnouncement(makeDb(), { ...baseInput, category: 'gossip' }))
      .rejects.toThrow(/category/);
  });
  test('rejects invalid audience_type', async () => {
    await expect(createAnnouncement(makeDb(), { ...baseInput, audienceType: 'planet' }))
      .rejects.toThrow(/audience_type/);
  });
  test('audience_type=all forbids audience_* fields', async () => {
    await expect(createAnnouncement(makeDb(), {
      ...baseInput, audienceType: 'all', audienceBuildingId: UUID2,
    })).rejects.toThrow(/audience_\*/);
  });
  test('audience_type=building requires audience_building_id (UUID)', async () => {
    await expect(createAnnouncement(makeDb(), {
      ...baseInput, audienceType: 'building',
    })).rejects.toThrow(/audience_building_id required/);
    await expect(createAnnouncement(makeDb(), {
      ...baseInput, audienceType: 'building', audienceBuildingId: 'bad',
    })).rejects.toThrow(/audience_building_id/);
  });
  test('audience_type=entrance rejects extra audience_* fields', async () => {
    await expect(createAnnouncement(makeDb(), {
      ...baseInput, audienceType: 'entrance', audienceEntranceId: UUID2, audienceBuildingId: UUID3,
    })).rejects.toThrow(/only audience_entrance_id/);
  });
  test('audience_type=unit_type requires valid unit type', async () => {
    await expect(createAnnouncement(makeDb(), {
      ...baseInput, audienceType: 'unit_type',
    })).rejects.toThrow(/audience_unit_type required/);
    await expect(createAnnouncement(makeDb(), {
      ...baseInput, audienceType: 'unit_type', audienceUnitType: 'squatter',
    })).rejects.toThrow(/audience_unit_type/);
  });
  test('rejects empty / unknown channels', async () => {
    await expect(createAnnouncement(makeDb(), { ...baseInput, notifyChannels: [] }))
      .rejects.toThrow(/notify_channels/);
    await expect(createAnnouncement(makeDb(), { ...baseInput, notifyChannels: ['carrier_pigeon'] }))
      .rejects.toThrow(/channel/);
  });
  test('is_urgent=true requires web_push in channels', async () => {
    await expect(createAnnouncement(makeDb(), {
      ...baseInput, isUrgent: true, notifyChannels: ['sms'],
    })).rejects.toThrow(/web_push/);
  });
  test('rejects invalid starts_at/expires_at', async () => {
    await expect(createAnnouncement(makeDb(), { ...baseInput, startsAt: 'not a date' }))
      .rejects.toThrow(/starts_at/);
    await expect(createAnnouncement(makeDb(), { ...baseInput, expiresAt: 'tomorrow' }))
      .rejects.toThrow(/expires_at/);
  });
  test('rejects expires_at <= starts_at', async () => {
    await expect(createAnnouncement(makeDb(), {
      ...baseInput,
      startsAt: '2026-04-20T10:00:00Z',
      expiresAt: '2026-04-20T10:00:00Z',
    })).rejects.toThrow(/time window/);
  });
  test('happy insert — SQL shape + default channels[web_push] + draft state', async () => {
    let lastArgs = null;
    const row = { id: UUID4, title: 'x', published_at: null };
    const db = makeDb([
      ['INSERT INTO announcements_v2', (_sql, args) => { lastArgs = args; return { rows: [row] }; }],
    ]);
    const out = await createAnnouncement(db, baseInput);
    expect(out).toEqual(row);
    expect(lastArgs[0]).toBe(UUID);           // property_id
    expect(lastArgs[1]).toBe('Лифт на ремонте'); // title trimmed
    expect(lastArgs[2]).toBe('Detail');       // body_md
    expect(lastArgs[3]).toBe(false);          // is_urgent default
    expect(lastArgs[4]).toBe('general');      // category default
    expect(lastArgs[5]).toBe('all');          // audience_type default
    expect(lastArgs[12]).toEqual(['web_push']); // notify_channels default
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// listForResident
// ══════════════════════════════════════════════════════════════════════════════

describe('listForResident', () => {
  const ctx = {
    residentId: UUID,
    buildingId: UUID2,
    entranceId: UUID3,
    residentType: 'owner',
  };

  test('empty ctx → no query, empty list', async () => {
    const db = makeDb();
    const r = await listForResident(db, null);
    expect(r).toEqual({ rows: [], count: 0 });
    expect(db.calls.length).toBe(0);
  });
  test('empty residentId → no query', async () => {
    const r = await listForResident(makeDb(), { residentId: null });
    expect(r.rows).toEqual([]);
  });
  test('default onlyActive=true → filters starts_at + expires_at', async () => {
    const db = makeDb([[/FROM announcements_v2/, () => ({ rows: [] })]]);
    await listForResident(db, ctx);
    const sql = db.calls[0].sql;
    expect(sql).toContain('starts_at <= NOW()');
    expect(sql).toContain('expires_at IS NULL OR expires_at > NOW()');
    expect(sql).toContain('published_at IS NOT NULL');
    expect(sql).toContain('deleted_at IS NULL');
  });
  test('onlyActive=false disables time filters', async () => {
    const db = makeDb([[/FROM announcements_v2/, () => ({ rows: [] })]]);
    await listForResident(db, ctx, { onlyActive: false });
    const sql = db.calls[0].sql;
    expect(sql).not.toContain('starts_at <= NOW()');
  });
  test('audience filter branches (all|building|entrance|unit_type) all in WHERE', async () => {
    const db = makeDb([[/FROM announcements_v2/, () => ({ rows: [] })]]);
    await listForResident(db, ctx);
    const sql = db.calls[0].sql;
    expect(sql).toContain("audience_type = 'all'");
    expect(sql).toContain("audience_type = 'building' AND audience_building_id");
    expect(sql).toContain("audience_type = 'entrance' AND audience_entrance_id");
    expect(sql).toContain("audience_type = 'unit_type' AND audience_unit_type");
    const args = db.calls[0].args;
    // [residentId, buildingId, entranceId, residentType, limit]
    expect(args[0]).toBe(UUID);
    expect(args[1]).toBe(UUID2);
    expect(args[2]).toBe(UUID3);
    expect(args[3]).toBe('owner');
    expect(args[args.length - 1]).toBe(50); // default limit
  });
  test('category filter — passes through, rejects unknown', async () => {
    const db = makeDb([[/FROM announcements_v2/, () => ({ rows: [] })]]);
    await listForResident(db, ctx, { category: 'event' });
    expect(db.calls[0].sql).toContain('category = $');
    expect(db.calls[0].args).toContain('event');

    await expect(listForResident(makeDb(), ctx, { category: 'gossip' }))
      .rejects.toThrow(/category/);
  });
  test('sort: pinned DESC, urgent DESC, starts_at DESC', async () => {
    const db = makeDb([[/FROM announcements_v2/, () => ({ rows: [] })]]);
    await listForResident(db, ctx);
    const sql = db.calls[0].sql;
    expect(sql).toContain('ORDER BY is_pinned DESC, is_urgent DESC, starts_at DESC');
  });
  test('clamps limit', async () => {
    const db = makeDb([[/FROM announcements_v2/, () => ({ rows: [] })]]);
    await listForResident(db, ctx, { limit: 9999 });
    expect(db.calls[0].args[db.calls[0].args.length - 1]).toBe(200);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// listForAdmin — status branches
// ══════════════════════════════════════════════════════════════════════════════

describe('listForAdmin', () => {
  test('draft → published_at IS NULL AND deleted_at IS NULL', async () => {
    const db = makeDb([[/FROM announcements_v2/, () => ({ rows: [] })]]);
    await listForAdmin(db, UUID, { status: 'draft' });
    expect(db.calls[0].sql).toContain('published_at IS NULL AND deleted_at IS NULL');
  });
  test('scheduled → published AND starts_at > NOW()', async () => {
    const db = makeDb([[/FROM announcements_v2/, () => ({ rows: [] })]]);
    await listForAdmin(db, UUID, { status: 'scheduled' });
    expect(db.calls[0].sql).toContain('published_at IS NOT NULL AND starts_at > NOW()');
  });
  test('active → published AND starts_at <= NOW() AND expires checks', async () => {
    const db = makeDb([[/FROM announcements_v2/, () => ({ rows: [] })]]);
    await listForAdmin(db, UUID, { status: 'active' });
    const sql = db.calls[0].sql;
    expect(sql).toContain('published_at IS NOT NULL AND starts_at <= NOW()');
    expect(sql).toContain('expires_at IS NULL OR expires_at > NOW()');
  });
  test('expired → expires_at ≤ NOW()', async () => {
    const db = makeDb([[/FROM announcements_v2/, () => ({ rows: [] })]]);
    await listForAdmin(db, UUID, { status: 'expired' });
    expect(db.calls[0].sql).toContain('expires_at IS NOT NULL AND expires_at <= NOW()');
  });
  test('deleted → deleted_at IS NOT NULL', async () => {
    const db = makeDb([[/FROM announcements_v2/, () => ({ rows: [] })]]);
    await listForAdmin(db, UUID, { status: 'deleted' });
    expect(db.calls[0].sql).toContain('deleted_at IS NOT NULL');
  });
  test('unknown status → throws', async () => {
    await expect(listForAdmin(makeDb(), UUID, { status: 'lavender' }))
      .rejects.toThrow(/status/);
  });
  test('all (or undefined) shows everything with property_id filter', async () => {
    const db = makeDb([[/FROM announcements_v2/, () => ({ rows: [] })]]);
    await listForAdmin(db, UUID, { status: 'all' });
    expect(db.calls[0].sql).toContain('property_id = $1');
    expect(db.calls[0].sql).not.toContain('published_at IS');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// listPublic
// ══════════════════════════════════════════════════════════════════════════════

describe('listPublic', () => {
  test('only audience_type=all + emergency/maintenance + active window', async () => {
    const db = makeDb([[/FROM announcements_v2/, () => ({ rows: [] })]]);
    await listPublic(db, UUID);
    const { sql, args } = db.calls[0];
    expect(sql).toContain("audience_type = 'all'");
    expect(sql).toContain('category = ANY($2::text[])');
    expect(sql).toContain('starts_at <= NOW()');
    expect(sql).toContain('expires_at IS NULL OR expires_at > NOW()');
    expect(sql).toContain('deleted_at IS NULL');
    expect(sql).toContain('published_at IS NOT NULL');
    expect(args[1]).toEqual(['emergency', 'maintenance']);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// getById
// ══════════════════════════════════════════════════════════════════════════════

describe('getById', () => {
  test('null on non-UUID (no query)', async () => {
    const db = makeDb();
    expect(await getById(db, 'bad')).toBeNull();
    expect(db.calls.length).toBe(0);
  });
  test('null on miss', async () => {
    const db = makeDb([[/FROM announcements_v2/, () => ({ rows: [] })]]);
    expect(await getById(db, UUID)).toBeNull();
  });
  test('returns row on hit', async () => {
    const row = { id: UUID, title: 'x' };
    const db = makeDb([[/FROM announcements_v2/, () => ({ rows: [row] })]]);
    expect(await getById(db, UUID)).toEqual(row);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// updateAnnouncement — whitelist + draft-only + conflict
// ══════════════════════════════════════════════════════════════════════════════

describe('updateAnnouncement', () => {
  test('rejects non-UUID id', async () => {
    await expect(updateAnnouncement(makeDb(), 'bad', { title: 'x' }))
      .rejects.toThrow(/UUID/);
  });
  test('empty patch → conflict:noop', async () => {
    const r = await updateAnnouncement(makeDb(), UUID, {});
    expect(r.conflict).toBe('noop');
  });
  test('rejects unknown category', async () => {
    await expect(updateAnnouncement(makeDb(), UUID, { category: 'gossip' }))
      .rejects.toThrow(/category/);
  });
  test('rejects empty notifyChannels', async () => {
    await expect(updateAnnouncement(makeDb(), UUID, { notifyChannels: [] }))
      .rejects.toThrow(/notify_channels/);
  });
  test('rejects is_urgent=true with non-web_push channels', async () => {
    await expect(updateAnnouncement(makeDb(), UUID, {
      isUrgent: true, notifyChannels: ['sms'],
    })).rejects.toThrow(/web_push/);
  });
  test('requires audienceType when changing audience_* fields', async () => {
    await expect(updateAnnouncement(makeDb(), UUID, { audienceBuildingId: UUID2 }))
      .rejects.toThrow(/audience_type required/);
  });
  test('happy patch — UPDATE with whitelist, updates updated_at, draft-only guard', async () => {
    const row = { id: UUID, title: 'new', published_at: null };
    let updateArgs = null;
    const db = makeDb([
      ['UPDATE announcements_v2', (_sql, args) => {
        updateArgs = args; return { rows: [row] };
      }],
    ]);
    const r = await updateAnnouncement(db, UUID, {
      title: 'new',
      isPinned: true,
    });
    expect(r.conflict).toBeNull();
    expect(r.row).toEqual(row);
    const updateCall = db.calls.find((c) => c.sql.includes('UPDATE'));
    expect(updateCall.sql).toContain('title = $1');
    expect(updateCall.sql).toContain('is_pinned = $2');
    expect(updateCall.sql).toContain('deleted_at IS NULL');
    expect(updateCall.sql).toContain('published_at IS NULL');
    expect(updateCall.sql).toContain('updated_at = NOW()');
    expect(updateArgs).toEqual(['new', true, UUID]);
  });
  test('not_found conflict when row absent', async () => {
    const db = makeDb([
      ['UPDATE announcements_v2', () => ({ rows: [] })],
      ['SELECT id, published_at, deleted_at FROM announcements_v2', () => ({ rows: [] })],
    ]);
    const r = await updateAnnouncement(db, UUID, { title: 'x' });
    expect(r.conflict).toBe('not_found');
  });
  test('deleted conflict', async () => {
    const db = makeDb([
      ['UPDATE announcements_v2', () => ({ rows: [] })],
      [/SELECT id, published_at, deleted_at/, () => ({ rows: [{ id: UUID, deleted_at: new Date(), published_at: null }] })],
    ]);
    const r = await updateAnnouncement(db, UUID, { title: 'x' });
    expect(r.conflict).toBe('deleted');
  });
  test('already_published conflict', async () => {
    const db = makeDb([
      ['UPDATE announcements_v2', () => ({ rows: [] })],
      [/SELECT id, published_at, deleted_at/, () => ({ rows: [{ id: UUID, published_at: new Date(), deleted_at: null }] })],
    ]);
    const r = await updateAnnouncement(db, UUID, { title: 'x' });
    expect(r.conflict).toBe('already_published');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// publishAnnouncement — FOR UPDATE + conflict + fan-out
// ══════════════════════════════════════════════════════════════════════════════

describe('publishAnnouncement', () => {
  test('rejects non-UUID id/staffId', async () => {
    await expect(publishAnnouncement(makePool(), 'bad', UUID)).rejects.toThrow(/id/);
    await expect(publishAnnouncement(makePool(), UUID, 'bad')).rejects.toThrow(/staff_id/);
  });
  test('not_found conflict → ROLLBACK', async () => {
    const pool = makePool([
      ['BEGIN', () => ({})],
      ['FOR UPDATE', () => ({ rows: [] })],
      ['ROLLBACK', () => ({})],
    ]);
    const r = await publishAnnouncement(pool, UUID, UUID2);
    expect(r.conflict).toBe('not_found');
    expect(r.outboxRows).toEqual([]);
    expect(pool.calls.map((c) => c.sql).join(' | ')).toContain('ROLLBACK');
  });
  test('deleted conflict → ROLLBACK', async () => {
    const pool = makePool([
      ['BEGIN', () => ({})],
      ['FOR UPDATE', () => ({ rows: [{ id: UUID, deleted_at: new Date(), published_at: null }] })],
      ['ROLLBACK', () => ({})],
    ]);
    const r = await publishAnnouncement(pool, UUID, UUID2);
    expect(r.conflict).toBe('deleted');
  });
  test('already_published conflict → ROLLBACK', async () => {
    const pool = makePool([
      ['BEGIN', () => ({})],
      ['FOR UPDATE', () => ({ rows: [{ id: UUID, deleted_at: null, published_at: new Date() }] })],
      ['ROLLBACK', () => ({})],
    ]);
    const r = await publishAnnouncement(pool, UUID, UUID2);
    expect(r.conflict).toBe('already_published');
  });
  test('happy active path — audience=all → fan-out → COMMIT', async () => {
    const now = new Date();
    const startsAt = new Date(now.getTime() - 1000).toISOString();
    const draft = {
      id: UUID, property_id: UUID4, title: 'x', body_md: 'body',
      is_urgent: false, category: 'general',
      audience_type: 'all',
      audience_building_id: null, audience_entrance_id: null, audience_unit_type: null,
      starts_at: startsAt, expires_at: null,
      is_pinned: false, notify_channels: ['web_push', 'sms'],
      published_at: null, deleted_at: null,
    };
    const published = { ...draft, published_at: now.toISOString(), published_by_staff_id: UUID2 };
    let batchArgs = null;
    const pool = makePool([
      ['BEGIN', () => ({})],
      ['FOR UPDATE', () => ({ rows: [draft] })],
      ['UPDATE announcements_v2', () => ({ rows: [published] })],
      // resolveAudience for audience='all'
      [/FROM residents WHERE property_id = \$1 AND is_active = true/, () => ({
        rows: [{ id: 'r1' }, { id: 'r2' }],
      })],
      ['INSERT INTO notifications_outbox', (_sql, args) => {
        batchArgs = args;
        // 2 recipients × 2 channels = 4 rows
        return { rows: [{ id: 'o1' }, { id: 'o2' }, { id: 'o3' }, { id: 'o4' }] };
      }],
      ['COMMIT', () => ({})],
    ]);
    const r = await publishAnnouncement(pool, UUID, UUID2);
    expect(r.conflict).toBeNull();
    expect(r.row).toEqual(published);
    expect(r.outboxRows.length).toBe(4);
    expect(batchArgs).not.toBeNull();
    const sqls = pool.calls.map((c) => c.sql).join(' | ');
    expect(sqls).toContain('BEGIN');
    expect(sqls).toContain('FOR UPDATE');
    expect(sqls).toContain('UPDATE announcements_v2');
    expect(sqls).toContain('INSERT INTO notifications_outbox');
    expect(sqls).toContain('COMMIT');
  });
  test('scheduled path (starts_at > now) — publishes but NO fan-out', async () => {
    const future = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const draft = {
      id: UUID, property_id: UUID4, title: 'x', body_md: 'b',
      is_urgent: false, category: 'general',
      audience_type: 'all', audience_building_id: null, audience_entrance_id: null, audience_unit_type: null,
      starts_at: future, expires_at: null,
      is_pinned: false, notify_channels: ['web_push'],
      published_at: null, deleted_at: null,
    };
    const published = { ...draft, published_at: new Date().toISOString() };
    const pool = makePool([
      ['BEGIN', () => ({})],
      ['FOR UPDATE', () => ({ rows: [draft] })],
      ['UPDATE announcements_v2', () => ({ rows: [published] })],
      ['COMMIT', () => ({})],
    ]);
    const r = await publishAnnouncement(pool, UUID, UUID2);
    expect(r.conflict).toBeNull();
    expect(r.outboxRows).toEqual([]);
    const sqls = pool.calls.map((c) => c.sql).join(' | ');
    expect(sqls).not.toContain('INSERT INTO notifications_outbox');
    expect(sqls).toContain('COMMIT');
  });
  test('rolls back on UPDATE failure', async () => {
    const startsAt = new Date(Date.now() - 1000).toISOString();
    const draft = {
      id: UUID, property_id: UUID4, starts_at: startsAt,
      audience_type: 'all', notify_channels: ['web_push'],
      published_at: null, deleted_at: null,
    };
    const pool = makePool([
      ['BEGIN', () => ({})],
      ['FOR UPDATE', () => ({ rows: [draft] })],
      ['UPDATE announcements_v2', () => { throw new Error('fail'); }],
      ['ROLLBACK', () => ({})],
    ]);
    await expect(publishAnnouncement(pool, UUID, UUID2)).rejects.toThrow('fail');
    const sqls = pool.calls.map((c) => c.sql).join(' | ');
    expect(sqls).toContain('ROLLBACK');
    expect(sqls).not.toContain('COMMIT');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// unpublishAnnouncement
// ══════════════════════════════════════════════════════════════════════════════

describe('unpublishAnnouncement', () => {
  test('rejects non-UUID', async () => {
    await expect(unpublishAnnouncement(makeDb(), 'bad')).rejects.toThrow(/UUID/);
  });
  test('happy: sets published_at=NULL, returns row', async () => {
    const row = { id: UUID, published_at: null };
    const db = makeDb([
      ['UPDATE announcements_v2', () => ({ rows: [row] })],
    ]);
    const r = await unpublishAnnouncement(db, UUID);
    expect(r.conflict).toBeNull();
    expect(r.row).toEqual(row);
    expect(db.calls[0].sql).toContain('SET published_at = NULL');
    expect(db.calls[0].sql).toContain('published_by_staff_id = NULL');
  });
  test('not_found conflict', async () => {
    const db = makeDb([
      ['UPDATE announcements_v2', () => ({ rows: [] })],
      [/SELECT id, published_at, deleted_at/, () => ({ rows: [] })],
    ]);
    const r = await unpublishAnnouncement(db, UUID);
    expect(r.conflict).toBe('not_found');
  });
  test('deleted conflict', async () => {
    const db = makeDb([
      ['UPDATE announcements_v2', () => ({ rows: [] })],
      [/SELECT id, published_at, deleted_at/, () => ({ rows: [{ id: UUID, deleted_at: new Date(), published_at: new Date() }] })],
    ]);
    const r = await unpublishAnnouncement(db, UUID);
    expect(r.conflict).toBe('deleted');
  });
  test('not_published conflict when already draft', async () => {
    const db = makeDb([
      ['UPDATE announcements_v2', () => ({ rows: [] })],
      [/SELECT id, published_at, deleted_at/, () => ({ rows: [{ id: UUID, deleted_at: null, published_at: null }] })],
    ]);
    const r = await unpublishAnnouncement(db, UUID);
    expect(r.conflict).toBe('not_published');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// softDeleteAnnouncement
// ══════════════════════════════════════════════════════════════════════════════

describe('softDeleteAnnouncement', () => {
  test('rejects non-UUID', async () => {
    await expect(softDeleteAnnouncement(makeDb(), 'bad')).rejects.toThrow(/UUID/);
  });
  test('happy: sets deleted_at', async () => {
    const row = { id: UUID, deleted_at: new Date() };
    const db = makeDb([['UPDATE announcements_v2', () => ({ rows: [row] })]]);
    const r = await softDeleteAnnouncement(db, UUID);
    expect(r.conflict).toBeNull();
    expect(r.row).toEqual(row);
    expect(db.calls[0].sql).toContain('SET deleted_at = NOW()');
  });
  test('not_found', async () => {
    const db = makeDb([
      ['UPDATE announcements_v2', () => ({ rows: [] })],
      [/SELECT id, deleted_at FROM announcements_v2/, () => ({ rows: [] })],
    ]);
    const r = await softDeleteAnnouncement(db, UUID);
    expect(r.conflict).toBe('not_found');
  });
  test('already_deleted', async () => {
    const db = makeDb([
      ['UPDATE announcements_v2', () => ({ rows: [] })],
      [/SELECT id, deleted_at FROM announcements_v2/, () => ({ rows: [{ id: UUID, deleted_at: new Date() }] })],
    ]);
    const r = await softDeleteAnnouncement(db, UUID);
    expect(r.conflict).toBe('already_deleted');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// getReachMetrics
// ══════════════════════════════════════════════════════════════════════════════

describe('getReachMetrics', () => {
  test('null on non-UUID', async () => {
    expect(await getReachMetrics(makeDb(), 'bad')).toBeNull();
  });
  test('null when announcement missing', async () => {
    const db = makeDb([
      [/SELECT id, property_id, audience_type/, () => ({ rows: [] })],
    ]);
    expect(await getReachMetrics(db, UUID)).toBeNull();
  });
  test('aggregates audience size + outbox count + log status breakdown', async () => {
    const ann = {
      id: UUID, property_id: UUID2, audience_type: 'all',
      audience_building_id: null, audience_entrance_id: null, audience_unit_type: null,
    };
    const db = makeDb([
      [/SELECT id, property_id, audience_type/, () => ({ rows: [ann] })],
      [/SELECT COUNT\(\*\)::int AS n FROM residents WHERE property_id = \$1 AND is_active = true\s*$/,
        () => ({ rows: [{ n: 100 }] })],
      [/FROM notification_log_v2[\s\S]*WHERE outbox_id IN \([\s\S]*FROM notifications_outbox[\s\S]*WHERE correlation_id = \$1[\s\S]*AND property_id = \$2[\s\S]*AND property_id = \$2/,
        (_sql, args) => {
          expect(args).toEqual([UUID, UUID2]);
          return { rows: [
        { status: 'sent', n: 150 },
        { status: 'delivered', n: 140 },
        { status: 'failed', n: 10 },
          ] };
        }],
      [/SELECT COUNT\(\*\)::int AS n[\s\S]*FROM notifications_outbox[\s\S]*WHERE correlation_id = \$1[\s\S]*AND property_id = \$2/,
        (_sql, args) => {
          expect(args).toEqual([UUID, UUID2]);
          return { rows: [{ n: 200 }] };
        }],
    ]);
    const m = await getReachMetrics(db, UUID);
    expect(m).toEqual({
      announcement_id: UUID,
      audience_size: 100,
      outbox_count: 200,
      log_sent: 150,
      log_delivered: 140,
      log_failed: 10,
    });
  });
  test('audience=building joins units.building_id', async () => {
    const ann = {
      id: UUID, property_id: UUID2, audience_type: 'building',
      audience_building_id: UUID3, audience_entrance_id: null, audience_unit_type: null,
    };
    let audienceSql = null;
    const db = makeDb([
      [/SELECT id, property_id, audience_type/, () => ({ rows: [ann] })],
      [/JOIN units u ON u.id = r.unit_id\s*WHERE r.property_id = \$1 AND r.is_active = true\s*AND u.building_id/,
        (sql) => { audienceSql = sql; return { rows: [{ n: 33 }] }; }],
      [/FROM notifications_outbox/, () => ({ rows: [{ n: 0 }] })],
      [/FROM notification_log_v2/, () => ({ rows: [] })],
    ]);
    const m = await getReachMetrics(db, UUID);
    expect(m.audience_size).toBe(33);
    expect(audienceSql).toContain('u.building_id');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// runScheduledFanout — cron
// ══════════════════════════════════════════════════════════════════════════════

describe('runScheduledFanout', () => {
  test('no pending → empty stats', async () => {
    const pool = makePool([
      ['BEGIN', () => ({})],
      [/FOR UPDATE OF a SKIP LOCKED/, () => ({ rows: [] })],
      ['COMMIT', () => ({})],
    ]);
    const stats = await runScheduledFanout(pool);
    expect(stats).toEqual([]);
  });
  test('NOT EXISTS subquery used for idempotency', async () => {
    const pool = makePool([
      ['BEGIN', () => ({})],
      [/FOR UPDATE OF a SKIP LOCKED/, (sql) => {
        expect(sql).toContain('NOT EXISTS');
        expect(sql).toContain('notifications_outbox o');
        expect(sql).toContain('o.correlation_id = a.id');
        return { rows: [] };
      }],
      ['COMMIT', () => ({})],
    ]);
    await runScheduledFanout(pool);
  });
  test('fan-out per pending announcement + COMMIT', async () => {
    const a1 = {
      id: UUID, property_id: UUID4, audience_type: 'all',
      notify_channels: ['web_push'], title: 't', body_md: 'b', is_urgent: false,
      category: 'general',
    };
    const pool = makePool([
      ['BEGIN', () => ({})],
      [/FOR UPDATE OF a SKIP LOCKED/, () => ({ rows: [a1] })],
      [/FROM residents WHERE property_id = \$1 AND is_active = true/, () => ({
        rows: [{ id: 'r1' }],
      })],
      ['INSERT INTO notifications_outbox', () => ({ rows: [{ id: 'o1' }] })],
      ['COMMIT', () => ({})],
    ]);
    const stats = await runScheduledFanout(pool);
    expect(stats).toEqual([{ id: UUID, outbox_count: 1 }]);
  });
  test('rolls back on failure', async () => {
    const pool = makePool([
      ['BEGIN', () => ({})],
      [/FOR UPDATE OF a SKIP LOCKED/, () => { throw new Error('lockfail'); }],
      ['ROLLBACK', () => ({})],
    ]);
    await expect(runScheduledFanout(pool)).rejects.toThrow('lockfail');
    const sqls = pool.calls.map((c) => c.sql).join(' | ');
    expect(sqls).toContain('ROLLBACK');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// resolveAudience — branch coverage (через publishAnnouncement happy path)
// ══════════════════════════════════════════════════════════════════════════════

describe('resolveAudience branches', () => {
  function makeDraft(overrides) {
    const startsAt = new Date(Date.now() - 1000).toISOString();
    return {
      id: UUID, property_id: UUID4, title: 'x', body_md: 'b',
      is_urgent: false, category: 'general',
      audience_type: 'all',
      audience_building_id: null, audience_entrance_id: null, audience_unit_type: null,
      starts_at: startsAt, expires_at: null,
      is_pinned: false, notify_channels: ['web_push'],
      published_at: null, deleted_at: null,
      ...overrides,
    };
  }

  test('building → JOIN units ON u.building_id = $2', async () => {
    const draft = makeDraft({ audience_type: 'building', audience_building_id: UUID3 });
    const published = { ...draft, published_at: new Date().toISOString() };
    let audSql = null;
    const pool = makePool([
      ['BEGIN', () => ({})],
      ['FOR UPDATE', () => ({ rows: [draft] })],
      ['UPDATE announcements_v2', () => ({ rows: [published] })],
      [/JOIN units u ON u.id = r.unit_id[\s\S]*u.building_id = \$2/, (sql) => {
        audSql = sql;
        return { rows: [{ id: 'r1' }, { id: 'r2' }] };
      }],
      ['INSERT INTO notifications_outbox', () => ({ rows: [{ id: 'o1' }, { id: 'o2' }] })],
      ['COMMIT', () => ({})],
    ]);
    const r = await publishAnnouncement(pool, UUID, UUID2);
    expect(r.outboxRows.length).toBe(2);
    expect(audSql).toContain('u.building_id');
  });

  test('entrance → JOIN units ON u.entrance_id', async () => {
    const draft = makeDraft({ audience_type: 'entrance', audience_entrance_id: UUID3 });
    const published = { ...draft, published_at: new Date().toISOString() };
    const pool = makePool([
      ['BEGIN', () => ({})],
      ['FOR UPDATE', () => ({ rows: [draft] })],
      ['UPDATE announcements_v2', () => ({ rows: [published] })],
      [/u.entrance_id = \$2/, () => ({ rows: [{ id: 'r1' }] })],
      ['INSERT INTO notifications_outbox', () => ({ rows: [{ id: 'o1' }] })],
      ['COMMIT', () => ({})],
    ]);
    const r = await publishAnnouncement(pool, UUID, UUID2);
    expect(r.outboxRows.length).toBe(1);
  });

  test('unit_type → resident_type filter (no unit join)', async () => {
    const draft = makeDraft({ audience_type: 'unit_type', audience_unit_type: 'owner' });
    const published = { ...draft, published_at: new Date().toISOString() };
    const pool = makePool([
      ['BEGIN', () => ({})],
      ['FOR UPDATE', () => ({ rows: [draft] })],
      ['UPDATE announcements_v2', () => ({ rows: [published] })],
      [/resident_type = \$2/, () => ({ rows: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }] })],
      ['INSERT INTO notifications_outbox', () => ({ rows: [{ id: 'o1' }, { id: 'o2' }, { id: 'o3' }] })],
      ['COMMIT', () => ({})],
    ]);
    const r = await publishAnnouncement(pool, UUID, UUID2);
    expect(r.outboxRows.length).toBe(3);
  });

  test('audience empty → no outbox rows, still COMMIT', async () => {
    const draft = makeDraft({ audience_type: 'all' });
    const published = { ...draft, published_at: new Date().toISOString() };
    const pool = makePool([
      ['BEGIN', () => ({})],
      ['FOR UPDATE', () => ({ rows: [draft] })],
      ['UPDATE announcements_v2', () => ({ rows: [published] })],
      [/FROM residents WHERE property_id/, () => ({ rows: [] })],
      ['COMMIT', () => ({})],
    ]);
    const r = await publishAnnouncement(pool, UUID, UUID2);
    expect(r.outboxRows).toEqual([]);
    const sqls = pool.calls.map((c) => c.sql).join(' | ');
    expect(sqls).not.toContain('INSERT INTO notifications_outbox');
    expect(sqls).toContain('COMMIT');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// resolve helpers
// ══════════════════════════════════════════════════════════════════════════════

describe('resolveResidentContextByUid', () => {
  test('null on empty uid (no query)', async () => {
    const db = makeDb();
    expect(await resolveResidentContextByUid(db, null)).toBeNull();
    expect(await resolveResidentContextByUid(db, '')).toBeNull();
    expect(db.calls.length).toBe(0);
  });
  test('null on miss', async () => {
    const db = makeDb([[/FROM residents r/, () => ({ rows: [] })]]);
    expect(await resolveResidentContextByUid(db, 'uid1')).toBeNull();
  });
  test('full ctx on hit (join units)', async () => {
    const db = makeDb([[/FROM residents r\s*JOIN units u ON u\.id = r\.unit_id/, () => ({ rows: [{
      id: UUID, property_id: UUID2, unit_id: UUID3, resident_type: 'owner',
      building_id: UUID4, entrance_id: 'e1',
    }] })]]);
    const ctx = await resolveResidentContextByUid(db, 'uid1');
    expect(ctx).toEqual({
      residentId: UUID,
      propertyId: UUID2,
      unitId: UUID3,
      buildingId: UUID4,
      entranceId: 'e1',
      residentType: 'owner',
    });
  });
});

describe('resolveStaffIdByUid', () => {
  test('null on empty uid', async () => {
    expect(await resolveStaffIdByUid(makeDb(), null)).toBeNull();
  });
  test('uses staff_users.external_uid', async () => {
    const db = makeDb([[/FROM staff_users WHERE external_uid/, () => ({ rows: [{ id: UUID }] })]]);
    expect(await resolveStaffIdByUid(db, 'u1')).toBe(UUID);
  });
  test('null on miss', async () => {
    const db = makeDb([[/FROM staff_users/, () => ({ rows: [] })]]);
    expect(await resolveStaffIdByUid(db, 'u1')).toBeNull();
  });
});

describe('resolvePropertyIdBySlug', () => {
  test('null on empty/non-string', async () => {
    expect(await resolvePropertyIdBySlug(makeDb(), null)).toBeNull();
    expect(await resolvePropertyIdBySlug(makeDb(), 123)).toBeNull();
  });
  test('resolves via properties.slug', async () => {
    const db = makeDb([[/FROM properties WHERE slug/, () => ({ rows: [{ id: UUID }] })]]);
    expect(await resolvePropertyIdBySlug(db, 'zamosk')).toBe(UUID);
  });
});
