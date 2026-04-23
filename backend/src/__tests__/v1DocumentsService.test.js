'use strict';

/**
 * Phase 5 (platform-v1) — documents_v2 service unit tests.
 * Spec: docs/product/specs/platform-v1/documents-v2-spec.md §2-§5.
 *
 * Pattern: мокаем только db.query / pool.connect/query интерфейсы.
 * Никаких реальных INSERT'ов — проверяем шейп SQL + args.
 *
 * Coverage:
 *   • constants + helpers (clampLimit, isValidUuid, validateFileUrl, validateCategory)
 *   • assertConciergeCanWriteCategory — capability gate
 *   • validateCreateInput — все invariants (propertyId, title, category,
 *     body|file, file fields required when file_url, tag length, UUIDs)
 *   • listForResident / listForStaff / listPublic — WHERE piece shapes
 *   • getById — UUID guard, miss → null
 *   • createDocument — SQL shape, publishNow branch, capability check
 *   • updateDocument — whitelist, noop, not_found, deleted, snapshot-on-PATCH
 *     (2 trips: один с title change → snapshot, один с tag only → NO snapshot),
 *     version numbering (COALESCE MAX+1), transactional BEGIN/COMMIT/ROLLBACK
 *   • publishDocument — idempotent already_published, not_found, deleted
 *   • unpublishDocument — not_found/deleted/not_published conflicts
 *   • softDeleteDocument — not_found/already_deleted
 *   • listVersions / getVersion — order + integer guard
 *   • resolve helpers
 */

const { describe, test, expect } = require('@jest/globals');

const {
  ALLOWED_CATEGORIES,
  CONCIERGE_CATEGORIES,
  PUBLIC_CATEGORIES,
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
  clampLimit,
  isValidUuid,
  validateFileUrl,
  validateCategory,
  assertConciergeCanWriteCategory,
  listForResident,
  listForStaff,
  listPublic,
  getById,
  createDocument,
  updateDocument,
  publishDocument,
  unpublishDocument,
  softDeleteDocument,
  listVersions,
  getVersion,
  resolveStaffIdByUid,
  resolvePropertyIdBySlug,
  resolvePropertyIdByResidentUid,
} = require('../v1/services/documents');

const UUID = '11111111-2222-3333-4444-555555555555';
const UUID2 = '22222222-2222-3333-4444-555555555555';
const UUID3 = '33333333-2222-3333-4444-555555555555';

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
  test('ALLOWED_CATEGORIES matches spec §2.1 enum', () => {
    expect(ALLOWED_CATEGORIES).toEqual([
      'rules', 'contacts', 'instructions', 'contracts', 'safety', 'legal', 'other',
    ]);
  });
  test('CONCIERGE_CATEGORIES is subset allowed for concierge (§3)', () => {
    expect(CONCIERGE_CATEGORIES).toEqual(['contacts', 'instructions']);
    for (const c of CONCIERGE_CATEGORIES) expect(ALLOWED_CATEGORIES).toContain(c);
  });
  test('PUBLIC_CATEGORIES excludes legal/contracts (§3)', () => {
    expect(PUBLIC_CATEGORIES).toEqual(['rules', 'contacts', 'safety']);
    expect(PUBLIC_CATEGORIES).not.toContain('legal');
    expect(PUBLIC_CATEGORIES).not.toContain('contracts');
  });
  test('list limits', () => {
    expect(DEFAULT_LIST_LIMIT).toBe(100);
    expect(MAX_LIST_LIMIT).toBe(500);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// helpers
// ══════════════════════════════════════════════════════════════════════════════

describe('clampLimit', () => {
  test('default when no input', () => expect(clampLimit()).toBe(100));
  test('default for zero/negative/NaN', () => {
    expect(clampLimit(0)).toBe(100);
    expect(clampLimit(-3)).toBe(100);
    expect(clampLimit('abc')).toBe(100);
  });
  test('caps at MAX', () => expect(clampLimit(9999)).toBe(500));
  test('passes through normal', () => expect(clampLimit(42)).toBe(42));
});

describe('isValidUuid', () => {
  test('accepts canonical UUID', () => expect(isValidUuid(UUID)).toBe(true));
  test('rejects garbage', () => {
    expect(isValidUuid('')).toBe(false);
    expect(isValidUuid('not-a-uuid')).toBe(false);
    expect(isValidUuid(null)).toBe(false);
    expect(isValidUuid(42)).toBe(false);
  });
});

describe('validateFileUrl', () => {
  test('null/undefined — ok (no-op)', () => {
    expect(() => validateFileUrl(null)).not.toThrow();
    expect(() => validateFileUrl(undefined)).not.toThrow();
  });
  test('non-string rejected', () => {
    expect(() => validateFileUrl(42)).toThrow(/string/);
  });
  test('external URL rejected', () => {
    expect(() => validateFileUrl('https://evil.com/x.pdf')).toThrow(/\/uploads\//);
  });
  test('local /uploads/ accepted', () => {
    expect(() => validateFileUrl('/uploads/doc.pdf')).not.toThrow();
  });
});

describe('validateCategory', () => {
  test('accepts all ALLOWED_CATEGORIES', () => {
    for (const c of ALLOWED_CATEGORIES) {
      expect(() => validateCategory(c)).not.toThrow();
    }
  });
  test('rejects unknown', () => {
    expect(() => validateCategory('something-else')).toThrow(/category/);
  });
});

describe('assertConciergeCanWriteCategory', () => {
  test('admin can write into any', () => {
    for (const c of ALLOWED_CATEGORIES) {
      expect(() => assertConciergeCanWriteCategory('admin', c)).not.toThrow();
    }
  });
  test('property_admin can write into any', () => {
    for (const c of ALLOWED_CATEGORIES) {
      expect(() => assertConciergeCanWriteCategory('property_admin', c)).not.toThrow();
    }
  });
  test('concierge limited to contacts/instructions', () => {
    expect(() => assertConciergeCanWriteCategory('concierge', 'contacts')).not.toThrow();
    expect(() => assertConciergeCanWriteCategory('concierge', 'instructions')).not.toThrow();
    expect(() => assertConciergeCanWriteCategory('concierge', 'legal')).toThrow(/concierge/);
    expect(() => assertConciergeCanWriteCategory('concierge', 'contracts')).toThrow(/concierge/);
    expect(() => assertConciergeCanWriteCategory('concierge', 'safety')).toThrow(/concierge/);
  });
  test('other roles rejected', () => {
    expect(() => assertConciergeCanWriteCategory('resident', 'contacts')).toThrow(/role/);
    expect(() => assertConciergeCanWriteCategory('security', 'rules')).toThrow(/role/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// createDocument validation
// ══════════════════════════════════════════════════════════════════════════════

describe('createDocument validation', () => {
  const baseInput = {
    propertyId: UUID,
    title: 'Правила',
    category: 'rules',
    bodyMd: 'markdown content',
  };

  test('rejects missing propertyId', async () => {
    await expect(createDocument(makeDb(), { ...baseInput, propertyId: undefined }, { role: 'admin' }))
      .rejects.toThrow(/property_id/);
  });
  test('rejects non-UUID propertyId', async () => {
    await expect(createDocument(makeDb(), { ...baseInput, propertyId: 'bad' }, { role: 'admin' }))
      .rejects.toThrow(/property_id/);
  });
  test('rejects empty title', async () => {
    await expect(createDocument(makeDb(), { ...baseInput, title: '  ' }, { role: 'admin' }))
      .rejects.toThrow(/title/);
  });
  test('rejects missing category', async () => {
    await expect(createDocument(makeDb(), { ...baseInput, category: undefined }, { role: 'admin' }))
      .rejects.toThrow(/category/);
  });
  test('rejects unknown category', async () => {
    await expect(createDocument(makeDb(), { ...baseInput, category: 'gossip' }, { role: 'admin' }))
      .rejects.toThrow(/category/);
  });
  test('requires body_md or file_url', async () => {
    await expect(createDocument(makeDb(), { ...baseInput, bodyMd: null, fileUrl: null }, { role: 'admin' }))
      .rejects.toThrow(/body_md or file_url/);
  });
  test('file_url requires file_mime + file_size_bytes', async () => {
    await expect(createDocument(makeDb(), {
      ...baseInput, bodyMd: null, fileUrl: '/uploads/x.pdf', fileMime: null,
    }, { role: 'admin' })).rejects.toThrow(/file_mime/);

    await expect(createDocument(makeDb(), {
      ...baseInput, bodyMd: null, fileUrl: '/uploads/x.pdf',
      fileMime: 'application/pdf', fileSizeBytes: undefined,
    }, { role: 'admin' })).rejects.toThrow(/file_size_bytes/);
  });
  test('external file_url rejected', async () => {
    await expect(createDocument(makeDb(), {
      ...baseInput, bodyMd: null, fileUrl: 'https://evil.com/x.pdf',
      fileMime: 'application/pdf', fileSizeBytes: 100,
    }, { role: 'admin' })).rejects.toThrow(/\/uploads\//);
  });
  test('tag > 40 chars rejected', async () => {
    await expect(createDocument(makeDb(), { ...baseInput, tag: 'x'.repeat(41) }, { role: 'admin' }))
      .rejects.toThrow(/tag/);
  });
  test('sortOrder must be integer', async () => {
    await expect(createDocument(makeDb(), { ...baseInput, sortOrder: 'first' }, { role: 'admin' }))
      .rejects.toThrow(/sort_order/);
  });

  test('concierge cannot create legal category', async () => {
    await expect(createDocument(makeDb(), { ...baseInput, category: 'legal' }, { role: 'concierge' }))
      .rejects.toThrow(/concierge/);
  });
  test('concierge can create instructions category', async () => {
    let gotArgs = null;
    const row = { id: UUID, title: 'x', published_at: null };
    const db = makeDb([
      ['INSERT INTO documents_v2', (_sql, args) => { gotArgs = args; return { rows: [row] }; }],
    ]);
    const r = await createDocument(db, { ...baseInput, category: 'instructions' }, { role: 'concierge' });
    expect(r).toEqual(row);
    expect(gotArgs).not.toBeNull();
  });

  test('happy insert — draft by default, SQL shape', async () => {
    let gotSql = '';
    let gotArgs = null;
    const row = { id: UUID, title: 'Правила', published_at: null };
    const db = makeDb([
      ['INSERT INTO documents_v2', (sql, args) => {
        gotSql = sql; gotArgs = args; return { rows: [row] };
      }],
    ]);
    const r = await createDocument(db, baseInput, { role: 'admin' });
    expect(r).toEqual(row);
    expect(gotSql).toContain('INSERT INTO documents_v2');
    // publishNow=false → NULL published_at в SQL литералом.
    expect(gotSql).toContain('NULL');
    expect(gotSql).not.toContain('NOW()');
    expect(gotArgs[0]).toBe(UUID);         // property_id
    expect(gotArgs[1]).toBe('Правила');    // title
    expect(gotArgs[2]).toBe('rules');      // category
    expect(gotArgs[4]).toBe('markdown content'); // body_md
  });

  test('publishNow=true → SQL uses NOW() for published_at', async () => {
    let gotSql = '';
    const row = { id: UUID, published_at: new Date() };
    const db = makeDb([
      ['INSERT INTO documents_v2', (sql, _args) => { gotSql = sql; return { rows: [row] }; }],
    ]);
    await createDocument(db, baseInput, { role: 'admin', publishNow: true });
    expect(gotSql).toContain('NOW()');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// listForResident
// ══════════════════════════════════════════════════════════════════════════════

describe('listForResident', () => {
  test('non-UUID → empty, no query', async () => {
    const db = makeDb();
    const r = await listForResident(db, 'bad');
    expect(r).toEqual({ rows: [], count: 0 });
    expect(db.calls.length).toBe(0);
  });
  test('default filters: deleted_at IS NULL + published_at IS NOT NULL', async () => {
    const db = makeDb([[/FROM documents_v2/, () => ({ rows: [] })]]);
    await listForResident(db, UUID);
    const sql = db.calls[0].sql;
    expect(sql).toContain('deleted_at IS NULL');
    expect(sql).toContain('published_at IS NOT NULL');
    expect(sql).toContain('property_id = $1');
  });
  test('category filter', async () => {
    const db = makeDb([[/FROM documents_v2/, () => ({ rows: [] })]]);
    await listForResident(db, UUID, { category: 'rules' });
    expect(db.calls[0].sql).toContain('category = $');
    expect(db.calls[0].args).toContain('rules');
  });
  test('rejects unknown category', async () => {
    await expect(listForResident(makeDb(), UUID, { category: 'gossip' }))
      .rejects.toThrow(/category/);
  });
  test('tag filter', async () => {
    const db = makeDb([[/FROM documents_v2/, () => ({ rows: [] })]]);
    await listForResident(db, UUID, { tag: 'fire-safety' });
    expect(db.calls[0].sql).toContain('tag = $');
    expect(db.calls[0].args).toContain('fire-safety');
  });
  test('clamps limit to MAX', async () => {
    const db = makeDb([[/FROM documents_v2/, () => ({ rows: [] })]]);
    await listForResident(db, UUID, { limit: 99999 });
    const args = db.calls[0].args;
    expect(args[args.length - 1]).toBe(500);
  });
  test('sort order', async () => {
    const db = makeDb([[/FROM documents_v2/, () => ({ rows: [] })]]);
    await listForResident(db, UUID);
    expect(db.calls[0].sql).toContain(
      'ORDER BY category ASC, sort_order ASC, updated_at DESC',
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// listForStaff
// ══════════════════════════════════════════════════════════════════════════════

describe('listForStaff', () => {
  test('non-UUID → empty', async () => {
    const r = await listForStaff(makeDb(), 'bad');
    expect(r).toEqual({ rows: [], count: 0 });
  });
  test('default: deleted hidden, draft hidden', async () => {
    const db = makeDb([[/FROM documents_v2/, () => ({ rows: [] })]]);
    await listForStaff(db, UUID);
    const sql = db.calls[0].sql;
    expect(sql).toContain('deleted_at IS NULL');
    expect(sql).toContain('published_at IS NOT NULL');
  });
  test('includeDraft=true removes published filter', async () => {
    const db = makeDb([[/FROM documents_v2/, () => ({ rows: [] })]]);
    await listForStaff(db, UUID, { includeDraft: true });
    expect(db.calls[0].sql).not.toContain('published_at IS NOT NULL');
  });
  test('includeDeleted=true removes deleted filter', async () => {
    const db = makeDb([[/FROM documents_v2/, () => ({ rows: [] })]]);
    await listForStaff(db, UUID, { includeDeleted: true });
    expect(db.calls[0].sql).not.toContain('deleted_at IS NULL');
  });
  test('include both → neither filter', async () => {
    const db = makeDb([[/FROM documents_v2/, () => ({ rows: [] })]]);
    await listForStaff(db, UUID, { includeDraft: true, includeDeleted: true });
    const sql = db.calls[0].sql;
    expect(sql).not.toContain('deleted_at IS NULL');
    expect(sql).not.toContain('published_at IS NOT NULL');
  });
  test('category filter', async () => {
    const db = makeDb([[/FROM documents_v2/, () => ({ rows: [] })]]);
    await listForStaff(db, UUID, { category: 'legal' });
    expect(db.calls[0].args).toContain('legal');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// listPublic
// ══════════════════════════════════════════════════════════════════════════════

describe('listPublic', () => {
  test('category restricted to PUBLIC_CATEGORIES, is_public=true', async () => {
    const db = makeDb([[/FROM documents_v2/, () => ({ rows: [] })]]);
    await listPublic(db, UUID);
    const { sql, args } = db.calls[0];
    expect(sql).toContain('is_public = true');
    expect(sql).toContain('category = ANY($2::text[])');
    expect(sql).toContain('published_at IS NOT NULL');
    expect(sql).toContain('deleted_at IS NULL');
    expect(args[1]).toEqual(['rules', 'contacts', 'safety']);
  });
  test('order', async () => {
    const db = makeDb([[/FROM documents_v2/, () => ({ rows: [] })]]);
    await listPublic(db, UUID);
    expect(db.calls[0].sql).toContain('ORDER BY category ASC, sort_order ASC, updated_at DESC');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// getById
// ══════════════════════════════════════════════════════════════════════════════

describe('getById', () => {
  test('null on non-UUID, no query', async () => {
    const db = makeDb();
    expect(await getById(db, 'bad')).toBeNull();
    expect(db.calls.length).toBe(0);
  });
  test('null on miss', async () => {
    const db = makeDb([[/FROM documents_v2/, () => ({ rows: [] })]]);
    expect(await getById(db, UUID)).toBeNull();
  });
  test('returns row on hit', async () => {
    const row = { id: UUID, title: 'x' };
    const db = makeDb([[/FROM documents_v2/, () => ({ rows: [row] })]]);
    expect(await getById(db, UUID)).toEqual(row);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// updateDocument — whitelist, snapshot-on-PATCH, conflicts
// ══════════════════════════════════════════════════════════════════════════════

describe('updateDocument', () => {
  test('rejects non-UUID id', async () => {
    await expect(updateDocument(makePool(), 'bad', { title: 'x' }))
      .rejects.toThrow(/UUID/);
  });
  test('empty patch → noop', async () => {
    const r = await updateDocument(makePool(), UUID, {});
    expect(r.conflict).toBe('noop');
  });
  test('patch with only non-whitelisted keys → noop', async () => {
    const r = await updateDocument(makePool(), UUID, { foo: 'bar', property_id: UUID2 });
    expect(r.conflict).toBe('noop');
  });

  test('rejects unknown category', async () => {
    // Важно: проверка бьётся раньше чем BEGIN — pool.connect не должен вызываться.
    await expect(updateDocument(makePool(), UUID, { category: 'gossip' }))
      .rejects.toThrow(/category/);
  });
  test('rejects external file_url', async () => {
    await expect(updateDocument(makePool(), UUID, { fileUrl: 'https://evil.com/x.pdf' }))
      .rejects.toThrow(/\/uploads\//);
  });

  test('not_found → ROLLBACK + conflict', async () => {
    const pool = makePool([
      ['BEGIN', () => ({})],
      [/FROM documents_v2 WHERE id = \$1/, () => ({ rows: [] })],
      ['ROLLBACK', () => ({})],
    ]);
    const r = await updateDocument(pool, UUID, { title: 'x' });
    expect(r.conflict).toBe('not_found');
    const sqls = pool.calls.map((c) => c.sql).join(' | ');
    expect(sqls).toContain('BEGIN');
    expect(sqls).toContain('ROLLBACK');
    expect(sqls).not.toContain('UPDATE documents_v2');
  });
  test('deleted → ROLLBACK + conflict', async () => {
    const pool = makePool([
      ['BEGIN', () => ({})],
      [/FROM documents_v2 WHERE id = \$1/, () => ({
        rows: [{ id: UUID, title: 't', body_md: 'b', file_url: null, category: 'rules', deleted_at: new Date() }],
      })],
      ['ROLLBACK', () => ({})],
    ]);
    const r = await updateDocument(pool, UUID, { title: 'x' });
    expect(r.conflict).toBe('deleted');
  });

  test('happy patch — tag only, no snapshot (body/title/file_url unchanged)', async () => {
    const cur = { id: UUID, title: 't', body_md: 'b', file_url: null, category: 'contacts', deleted_at: null };
    const upd = { ...cur, tag: 'new-tag' };
    let snapshotCalled = false;
    const pool = makePool([
      ['BEGIN', () => ({})],
      [/FROM documents_v2 WHERE id = \$1/, () => ({ rows: [cur] })],
      [/INSERT INTO document_versions/, () => { snapshotCalled = true; return { rows: [] }; }],
      [/UPDATE documents_v2/, () => ({ rows: [upd] })],
      ['COMMIT', () => ({})],
    ]);
    const r = await updateDocument(pool, UUID, { tag: 'new-tag' });
    expect(r.conflict).toBeNull();
    expect(r.row).toEqual(upd);
    expect(snapshotCalled).toBe(false);
    const sqls = pool.calls.map((c) => c.sql).join(' | ');
    expect(sqls).toContain('COMMIT');
    expect(sqls).not.toContain('document_versions');
  });

  test('snapshot-on-PATCH when title changes — inserts into document_versions with current values', async () => {
    const cur = {
      id: UUID, title: 'OLD', body_md: 'OLD_BODY', file_url: '/uploads/old.pdf',
      category: 'contacts', deleted_at: null,
    };
    const upd = { ...cur, title: 'NEW' };
    let snapshotArgs = null;
    let versionQueryArgs = null;
    const pool = makePool([
      ['BEGIN', () => ({})],
      [/FROM documents_v2 WHERE id = \$1/, () => ({ rows: [cur] })],
      [/SELECT COALESCE\(MAX\(version\), 0\) \+ 1 AS next_version/, (_sql, args) => {
        versionQueryArgs = args;
        return { rows: [{ next_version: 3 }] };
      }],
      [/INSERT INTO document_versions/, (_sql, args) => {
        snapshotArgs = args;
        return { rows: [] };
      }],
      [/UPDATE documents_v2/, () => ({ rows: [upd] })],
      ['COMMIT', () => ({})],
    ]);
    const r = await updateDocument(pool, UUID, { title: 'NEW' }, {
      updatedByStaffId: UUID2,
      reason: 'typo fix',
    });
    expect(r.conflict).toBeNull();
    expect(versionQueryArgs).toEqual([UUID]);
    // snapshot args: [id, version, title_snapshot, body_md_snapshot, file_url_snapshot, archived_by, reason]
    expect(snapshotArgs[0]).toBe(UUID);
    expect(snapshotArgs[1]).toBe(3);
    expect(snapshotArgs[2]).toBe('OLD');          // old title
    expect(snapshotArgs[3]).toBe('OLD_BODY');     // old body
    expect(snapshotArgs[4]).toBe('/uploads/old.pdf'); // old file_url
    expect(snapshotArgs[5]).toBe(UUID2);          // archived_by_staff_id
    expect(snapshotArgs[6]).toBe('typo fix');     // reason
  });

  test('snapshot-on-PATCH when body_md changes', async () => {
    const cur = { id: UUID, title: 't', body_md: 'OLD', file_url: null, category: 'rules', deleted_at: null };
    const pool = makePool([
      ['BEGIN', () => ({})],
      [/FROM documents_v2 WHERE id = \$1/, () => ({ rows: [cur] })],
      [/SELECT COALESCE\(MAX\(version\)/, () => ({ rows: [{ next_version: 1 }] })],
      [/INSERT INTO document_versions/, () => ({ rows: [] })],
      [/UPDATE documents_v2/, () => ({ rows: [{ ...cur, body_md: 'NEW' }] })],
      ['COMMIT', () => ({})],
    ]);
    const r = await updateDocument(pool, UUID, { bodyMd: 'NEW' });
    expect(r.conflict).toBeNull();
    const sqls = pool.calls.map((c) => c.sql).join(' | ');
    expect(sqls).toContain('INSERT INTO document_versions');
  });

  test('snapshot-on-PATCH when file_url changes', async () => {
    const cur = { id: UUID, title: 't', body_md: null, file_url: '/uploads/a.pdf', category: 'rules', deleted_at: null };
    const pool = makePool([
      ['BEGIN', () => ({})],
      [/FROM documents_v2 WHERE id = \$1/, () => ({ rows: [cur] })],
      [/SELECT COALESCE\(MAX\(version\)/, () => ({ rows: [{ next_version: 2 }] })],
      [/INSERT INTO document_versions/, () => ({ rows: [] })],
      [/UPDATE documents_v2/, () => ({ rows: [{ ...cur, file_url: '/uploads/b.pdf' }] })],
      ['COMMIT', () => ({})],
    ]);
    const r = await updateDocument(pool, UUID, { fileUrl: '/uploads/b.pdf' });
    expect(r.conflict).toBeNull();
    const sqls = pool.calls.map((c) => c.sql).join(' | ');
    expect(sqls).toContain('INSERT INTO document_versions');
  });

  test('whitelist — ignores unknown keys, maps to sql columns', async () => {
    const cur = { id: UUID, title: 't', body_md: 'b', file_url: null, category: 'contacts', deleted_at: null };
    let updateSql = '';
    let updateArgs = null;
    const pool = makePool([
      ['BEGIN', () => ({})],
      [/FROM documents_v2 WHERE id = \$1/, () => ({ rows: [cur] })],
      [/UPDATE documents_v2/, (sql, args) => {
        updateSql = sql; updateArgs = args; return { rows: [cur] };
      }],
      ['COMMIT', () => ({})],
    ]);
    await updateDocument(pool, UUID, {
      tag: 'new',
      sortOrder: 5,
      isPublic: true,
      foo: 'ignored',  // не в whitelist
      property_id: UUID2,  // не в whitelist
    });
    // whitelist order: [title, category, tag, bodyMd, fileUrl, fileMime,
    //   fileSizeBytes, isPublic, sortOrder] — т.е. tag → isPublic → sortOrder.
    expect(updateSql).toContain('tag = $1');
    expect(updateSql).toContain('is_public = $2');
    expect(updateSql).toContain('sort_order = $3');
    expect(updateSql).not.toContain('property_id = ');
    expect(updateSql).not.toContain('foo =');
    // args = ['new', true, 5, id]
    expect(updateArgs[0]).toBe('new');
    expect(updateArgs[1]).toBe(true);
    expect(updateArgs[2]).toBe(5);
    expect(updateArgs[updateArgs.length - 1]).toBe(UUID);
  });

  test('concierge cannot patch into legal category (capability gate)', async () => {
    const cur = { id: UUID, title: 't', body_md: 'b', file_url: null, category: 'contacts', deleted_at: null };
    const pool = makePool([
      ['BEGIN', () => ({})],
      [/FROM documents_v2 WHERE id = \$1/, () => ({ rows: [cur] })],
      ['ROLLBACK', () => ({})],
    ]);
    await expect(updateDocument(pool, UUID, { category: 'legal' }, { role: 'concierge' }))
      .rejects.toThrow(/concierge/);
  });

  test('concierge cannot patch existing legal doc (current category check)', async () => {
    const cur = { id: UUID, title: 't', body_md: 'b', file_url: null, category: 'legal', deleted_at: null };
    const pool = makePool([
      ['BEGIN', () => ({})],
      [/FROM documents_v2 WHERE id = \$1/, () => ({ rows: [cur] })],
      ['ROLLBACK', () => ({})],
    ]);
    // Просто меняем title — но category текущей row legal → блок.
    await expect(updateDocument(pool, UUID, { title: 'new' }, { role: 'concierge' }))
      .rejects.toThrow(/concierge/);
  });

  test('updated_by_staff_id appended to UPDATE when opts.updatedByStaffId', async () => {
    const cur = { id: UUID, title: 't', body_md: 'b', file_url: null, category: 'contacts', deleted_at: null };
    let updateSql = '';
    let updateArgs = null;
    const pool = makePool([
      ['BEGIN', () => ({})],
      [/FROM documents_v2 WHERE id = \$1/, () => ({ rows: [cur] })],
      [/UPDATE documents_v2/, (sql, args) => {
        updateSql = sql; updateArgs = args; return { rows: [cur] };
      }],
      ['COMMIT', () => ({})],
    ]);
    await updateDocument(pool, UUID, { tag: 'x' }, { updatedByStaffId: UUID2 });
    expect(updateSql).toContain('updated_by_staff_id =');
    expect(updateArgs).toContain(UUID2);
  });

  test('rolls back on UPDATE failure', async () => {
    const cur = { id: UUID, title: 't', body_md: 'b', file_url: null, category: 'contacts', deleted_at: null };
    const pool = makePool([
      ['BEGIN', () => ({})],
      [/FROM documents_v2 WHERE id = \$1/, () => ({ rows: [cur] })],
      [/UPDATE documents_v2/, () => { throw new Error('boom'); }],
      ['ROLLBACK', () => ({})],
    ]);
    await expect(updateDocument(pool, UUID, { tag: 'new' })).rejects.toThrow('boom');
    const sqls = pool.calls.map((c) => c.sql).join(' | ');
    expect(sqls).toContain('ROLLBACK');
    expect(sqls).not.toContain('COMMIT');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// publishDocument
// ══════════════════════════════════════════════════════════════════════════════

describe('publishDocument', () => {
  test('rejects non-UUID id', async () => {
    await expect(publishDocument(makeDb(), 'bad')).rejects.toThrow(/UUID/);
  });
  test('not_found on miss', async () => {
    const db = makeDb([[/FROM documents_v2 WHERE id = \$1/, () => ({ rows: [] })]]);
    const r = await publishDocument(db, UUID);
    expect(r.conflict).toBe('not_found');
  });
  test('deleted conflict', async () => {
    const db = makeDb([
      [/FROM documents_v2 WHERE id = \$1/, () => ({
        rows: [{ id: UUID, category: 'rules', deleted_at: new Date(), published_at: null }],
      })],
    ]);
    const r = await publishDocument(db, UUID);
    expect(r.conflict).toBe('deleted');
  });
  test('already_published → idempotent (returns existing row, conflict flag set)', async () => {
    const existing = { id: UUID, category: 'rules', deleted_at: null, published_at: new Date() };
    let updateCalled = false;
    const db = makeDb([
      [/FROM documents_v2 WHERE id = \$1/, () => ({ rows: [existing] })],
      [/UPDATE documents_v2/, () => { updateCalled = true; return { rows: [existing] }; }],
    ]);
    const r = await publishDocument(db, UUID);
    expect(r.conflict).toBe('already_published');
    expect(r.row).toEqual(existing);
    expect(updateCalled).toBe(false);
  });
  test('happy: SET published_at + updated_by', async () => {
    const draft = { id: UUID, category: 'rules', deleted_at: null, published_at: null };
    const published = { ...draft, published_at: new Date() };
    let updateSql = '';
    let updateArgs = null;
    const db = makeDb([
      [/FROM documents_v2 WHERE id = \$1/, () => ({ rows: [draft] })],
      [/UPDATE documents_v2/, (sql, args) => {
        updateSql = sql; updateArgs = args; return { rows: [published] };
      }],
    ]);
    const r = await publishDocument(db, UUID, { updatedByStaffId: UUID2 });
    expect(r.conflict).toBeNull();
    expect(r.row).toEqual(published);
    expect(updateSql).toContain('published_at = NOW()');
    expect(updateSql).toContain('deleted_at IS NULL');
    expect(updateArgs).toContain(UUID2);
  });
  test('concierge capability: cannot publish legal doc', async () => {
    const draft = { id: UUID, category: 'legal', deleted_at: null, published_at: null };
    const db = makeDb([
      [/FROM documents_v2 WHERE id = \$1/, () => ({ rows: [draft] })],
    ]);
    await expect(publishDocument(db, UUID, { role: 'concierge' })).rejects.toThrow(/concierge/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// unpublishDocument
// ══════════════════════════════════════════════════════════════════════════════

describe('unpublishDocument', () => {
  test('rejects non-UUID', async () => {
    await expect(unpublishDocument(makeDb(), 'bad')).rejects.toThrow(/UUID/);
  });
  test('happy — sets published_at=NULL', async () => {
    const row = { id: UUID, published_at: null };
    const db = makeDb([[/UPDATE documents_v2/, () => ({ rows: [row] })]]);
    const r = await unpublishDocument(db, UUID);
    expect(r.conflict).toBeNull();
    expect(r.row).toEqual(row);
    expect(db.calls[0].sql).toContain('SET published_at = NULL');
  });
  test('not_found', async () => {
    const db = makeDb([
      [/UPDATE documents_v2/, () => ({ rows: [] })],
      [/SELECT id, published_at, deleted_at/, () => ({ rows: [] })],
    ]);
    const r = await unpublishDocument(db, UUID);
    expect(r.conflict).toBe('not_found');
  });
  test('deleted', async () => {
    const db = makeDb([
      [/UPDATE documents_v2/, () => ({ rows: [] })],
      [/SELECT id, published_at, deleted_at/, () => ({
        rows: [{ id: UUID, deleted_at: new Date(), published_at: new Date() }],
      })],
    ]);
    const r = await unpublishDocument(db, UUID);
    expect(r.conflict).toBe('deleted');
  });
  test('not_published', async () => {
    const db = makeDb([
      [/UPDATE documents_v2/, () => ({ rows: [] })],
      [/SELECT id, published_at, deleted_at/, () => ({
        rows: [{ id: UUID, deleted_at: null, published_at: null }],
      })],
    ]);
    const r = await unpublishDocument(db, UUID);
    expect(r.conflict).toBe('not_published');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// softDeleteDocument
// ══════════════════════════════════════════════════════════════════════════════

describe('softDeleteDocument', () => {
  test('rejects non-UUID', async () => {
    await expect(softDeleteDocument(makeDb(), 'bad')).rejects.toThrow(/UUID/);
  });
  test('happy — sets deleted_at', async () => {
    const row = { id: UUID, deleted_at: new Date() };
    const db = makeDb([[/UPDATE documents_v2/, () => ({ rows: [row] })]]);
    const r = await softDeleteDocument(db, UUID);
    expect(r.conflict).toBeNull();
    expect(r.row).toEqual(row);
    expect(db.calls[0].sql).toContain('SET deleted_at = NOW()');
  });
  test('not_found', async () => {
    const db = makeDb([
      [/UPDATE documents_v2/, () => ({ rows: [] })],
      [/SELECT id, deleted_at FROM documents_v2/, () => ({ rows: [] })],
    ]);
    const r = await softDeleteDocument(db, UUID);
    expect(r.conflict).toBe('not_found');
  });
  test('already_deleted', async () => {
    const db = makeDb([
      [/UPDATE documents_v2/, () => ({ rows: [] })],
      [/SELECT id, deleted_at FROM documents_v2/, () => ({
        rows: [{ id: UUID, deleted_at: new Date() }],
      })],
    ]);
    const r = await softDeleteDocument(db, UUID);
    expect(r.conflict).toBe('already_deleted');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Versions
// ══════════════════════════════════════════════════════════════════════════════

describe('listVersions', () => {
  test('non-UUID → empty', async () => {
    const r = await listVersions(makeDb(), 'bad');
    expect(r).toEqual({ rows: [], count: 0 });
  });
  test('happy — ORDER BY version DESC', async () => {
    const versions = [{ version: 3 }, { version: 2 }, { version: 1 }];
    const db = makeDb([[/FROM document_versions/, () => ({ rows: versions })]]);
    const r = await listVersions(db, UUID);
    expect(r.rows).toEqual(versions);
    expect(r.count).toBe(3);
    expect(db.calls[0].sql).toContain('ORDER BY version DESC');
  });
});

describe('getVersion', () => {
  test('null on non-UUID', async () => {
    expect(await getVersion(makeDb(), 'bad', 1)).toBeNull();
  });
  test('null on invalid version', async () => {
    expect(await getVersion(makeDb(), UUID, 0)).toBeNull();
    expect(await getVersion(makeDb(), UUID, 'abc')).toBeNull();
    expect(await getVersion(makeDb(), UUID, -1)).toBeNull();
  });
  test('happy — queries with version int', async () => {
    const snap = { version: 5, title_snapshot: 't' };
    let gotArgs = null;
    const db = makeDb([
      [/FROM document_versions/, (_sql, args) => { gotArgs = args; return { rows: [snap] }; }],
    ]);
    const r = await getVersion(db, UUID, '5');
    expect(r).toEqual(snap);
    expect(gotArgs).toEqual([UUID, 5]);
  });
  test('null on miss', async () => {
    const db = makeDb([[/FROM document_versions/, () => ({ rows: [] })]]);
    expect(await getVersion(db, UUID, 999)).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Resolve helpers
// ══════════════════════════════════════════════════════════════════════════════

describe('resolveStaffIdByUid', () => {
  test('null on empty uid', async () => {
    expect(await resolveStaffIdByUid(makeDb(), null)).toBeNull();
    expect(await resolveStaffIdByUid(makeDb(), '')).toBeNull();
  });
  test('returns staff id', async () => {
    const db = makeDb([
      [/FROM staff_users/, () => ({ rows: [{ id: UUID }] })],
    ]);
    expect(await resolveStaffIdByUid(db, 'uid-1')).toBe(UUID);
  });
  test('null when not found', async () => {
    const db = makeDb([[/FROM staff_users/, () => ({ rows: [] })]]);
    expect(await resolveStaffIdByUid(db, 'uid-missing')).toBeNull();
  });
});

describe('resolvePropertyIdBySlug', () => {
  test('null on empty slug', async () => {
    expect(await resolvePropertyIdBySlug(makeDb(), null)).toBeNull();
    expect(await resolvePropertyIdBySlug(makeDb(), 42)).toBeNull();
  });
  test('returns property id', async () => {
    const db = makeDb([
      [/FROM properties/, () => ({ rows: [{ id: UUID3 }] })],
    ]);
    expect(await resolvePropertyIdBySlug(db, 'zamoskvorechie')).toBe(UUID3);
  });
});

describe('resolvePropertyIdByResidentUid', () => {
  test('null on empty uid', async () => {
    expect(await resolvePropertyIdByResidentUid(makeDb(), null)).toBeNull();
  });
  test('returns property_id', async () => {
    const db = makeDb([
      [/FROM residents/, () => ({ rows: [{ property_id: UUID2 }] })],
    ]);
    expect(await resolvePropertyIdByResidentUid(db, 'uid-1')).toBe(UUID2);
  });
  test('null when resident not found', async () => {
    const db = makeDb([[/FROM residents/, () => ({ rows: [] })]]);
    expect(await resolvePropertyIdByResidentUid(db, 'uid-missing')).toBeNull();
  });
});
