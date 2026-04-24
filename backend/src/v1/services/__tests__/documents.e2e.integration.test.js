'use strict';

// platform-v1 integration e2e — documents_v2 snapshot-on-PATCH + visibility.
// Spec: documents-v2-spec.md §5 AC:
//   item 6 «PATCH → перед UPDATE снимает snapshot в document_versions
//          (атомарно в одной транзакции); последовательные PATCH'и растят
//          version монотонно».
//   item 3 «capability matrix: concierge пишет только в contacts/instructions».
//   item 4 «listPublic ограничен rules/contacts/safety; legal/contracts
//          скрыты даже при is_public=true».
//
// Что проверяем end-to-end:
//   1. Snapshot pipeline: create(draft) → publish → update(title+body) →
//      document_versions[version=1] держит ПРЕЖНИЕ title+body (не новые).
//      → второй update → versions[version=1,2] монотонно.  Меняется body_md
//      → UPDATE и snapshot атомарны (если бы кинуло в середине — snapshot
//      не появилась бы; это пассивно проверяется тем, что в успешном
//      сценарии они парны).
//   2. Capability matrix: concierge создаёт contacts (OK) + legal (throws).
//      Админ создаёт legal (OK).  concierge update contacts→legal (throws).
//   3. listPublic visibility: published+is_public+rules (visible) /
//      published+is_public+legal (hidden, privacy) / draft (hidden) /
//      soft-deleted (hidden).
//
// В отличие от announcements/packages — НЕ триггерит outbox, поэтому
// channels.dispatch не мокается и outboxWorker не используется.
//
// Prerequisite — как announcements.e2e: TEST_DATABASE_URL + pgcrypto.
// Без env — describe.skip.

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });

const DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const describeIfPg = DATABASE_URL ? describe : describe.skip;

const { Pool } = require('pg');
const {
  createDocument,
  updateDocument,
  publishDocument,
  unpublishDocument,
  softDeleteDocument,
  listForStaff,
  listPublic,
  listVersions,
} = require('../documents');
const { applyV1Migrations, seedFixture, cleanupFixture } = require('./_fixtures');

describeIfPg('platform-v1 integration e2e: documents snapshot + visibility', () => {
  /** @type {Pool} */
  let pool;
  let dbReady = false;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    try {
      await pool.query('SELECT 1');
      await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
      await applyV1Migrations(pool);
      dbReady = true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[documents.e2e] skipping — DB not reachable:', err.message);
    }
  }, 60_000);

  afterAll(async () => {
    if (pool) await pool.end();
  });

  test('snapshot-on-PATCH: последовательные updates растят versions монотонно', async () => {
    if (!dbReady) return;
    const fixture = await seedFixture(pool);
    const { propertyId, staffId } = fixture;

    try {
      // 1. Create draft (role=property_admin по умолчанию в fixture).
      const doc = await createDocument(
        pool,
        {
          propertyId,
          title: 'Правила проживания v1',
          category: 'rules',
          bodyMd: 'Первая редакция текста правил.',
          createdByStaffId: staffId,
        },
        { role: 'property_admin' },
      );
      expect(doc.id).toMatch(/^[0-9a-f]{8}-/i);
      expect(doc.title).toBe('Правила проживания v1');
      expect(doc.published_at).toBeNull();

      // 2. Publish — без этого snapshot всё равно сработает (snapshot не
      //    зависит от published_at), но для реалистичности пушим.
      const pub = await publishDocument(pool, doc.id, {
        role: 'property_admin',
        updatedByStaffId: staffId,
      });
      expect(pub.conflict).toBeNull();
      expect(pub.row.published_at).not.toBeNull();

      // 3. До первого update'a — versions пуст.
      const verBefore = await listVersions(pool, doc.id);
      expect(verBefore.rows).toHaveLength(0);

      // 4. Первый update меняет title + bodyMd → snapshot(v=1) держит ОРИГИНАЛ.
      const upd1 = await updateDocument(
        pool,
        doc.id,
        { title: 'Правила проживания v2', bodyMd: 'Вторая редакция.' },
        { role: 'property_admin', updatedByStaffId: staffId, reason: 'typo fix' },
      );
      expect(upd1.conflict).toBeNull();
      expect(upd1.row.title).toBe('Правила проживания v2');
      expect(upd1.row.body_md).toBe('Вторая редакция.');

      const verAfter1 = await listVersions(pool, doc.id);
      expect(verAfter1.rows).toHaveLength(1);
      expect(verAfter1.rows[0].version).toBe(1);
      expect(verAfter1.rows[0].title_snapshot).toBe('Правила проживания v1');
      expect(verAfter1.rows[0].body_md_snapshot).toBe('Первая редакция текста правил.');
      expect(verAfter1.rows[0].reason).toBe('typo fix');
      expect(verAfter1.rows[0].archived_by_staff_id).toBe(staffId);

      // 5. Второй update — version=2 держит snapshot из шага 4.
      const upd2 = await updateDocument(
        pool,
        doc.id,
        { bodyMd: 'Третья редакция.' },
        { role: 'property_admin', updatedByStaffId: staffId, reason: 'clarification' },
      );
      expect(upd2.conflict).toBeNull();
      expect(upd2.row.body_md).toBe('Третья редакция.');

      const verAfter2 = await listVersions(pool, doc.id);
      expect(verAfter2.rows).toHaveLength(2);
      // listVersions sorts by version DESC.
      expect(verAfter2.rows[0].version).toBe(2);
      expect(verAfter2.rows[0].title_snapshot).toBe('Правила проживания v2');
      expect(verAfter2.rows[0].body_md_snapshot).toBe('Вторая редакция.');
      expect(verAfter2.rows[1].version).toBe(1);
      expect(verAfter2.rows[1].body_md_snapshot).toBe('Первая редакция текста правил.');

      // 6. Update БЕЗ snapshot-triggers (только sort_order) → versions не растёт.
      const upd3 = await updateDocument(
        pool,
        doc.id,
        { sortOrder: 5 },
        { role: 'property_admin', updatedByStaffId: staffId },
      );
      expect(upd3.conflict).toBeNull();
      expect(upd3.row.sort_order).toBe(5);

      const verAfter3 = await listVersions(pool, doc.id);
      expect(verAfter3.rows).toHaveLength(2); // без прироста.
    } finally {
      await cleanupFixture(pool, propertyId);
    }
  }, 30_000);

  test('capability matrix: concierge ограничен contacts/instructions', async () => {
    if (!dbReady) return;
    const fixture = await seedFixture(pool);
    const { propertyId, staffId } = fixture;

    try {
      // Concierge создаёт contacts — OK.
      const ok = await createDocument(
        pool,
        {
          propertyId,
          title: 'Контакты УК',
          category: 'contacts',
          bodyMd: '+7 495 000-00-00',
          createdByStaffId: staffId,
        },
        { role: 'concierge' },
      );
      expect(ok.category).toBe('contacts');

      // Concierge создаёт legal — throw.
      await expect(
        createDocument(
          pool,
          {
            propertyId,
            title: 'Договор управления',
            category: 'legal',
            bodyMd: 'Полный текст договора.',
            createdByStaffId: staffId,
          },
          { role: 'concierge' },
        ),
      ).rejects.toThrow(/concierge/);

      // Админ создаёт legal — OK.
      const legal = await createDocument(
        pool,
        {
          propertyId,
          title: 'Договор управления',
          category: 'legal',
          bodyMd: 'Полный текст договора.',
          createdByStaffId: staffId,
        },
        { role: 'property_admin' },
      );
      expect(legal.category).toBe('legal');

      // Concierge пытается update contacts → category=legal — throw
      // (assertConciergeCanWriteCategory проверяет новую категорию).
      await expect(
        updateDocument(
          pool,
          ok.id,
          { category: 'legal' },
          { role: 'concierge', updatedByStaffId: staffId },
        ),
      ).rejects.toThrow(/concierge/);

      // И concierge не может трогать уже-legal документ даже только title.
      await expect(
        updateDocument(
          pool,
          legal.id,
          { title: 'Новое название' },
          { role: 'concierge', updatedByStaffId: staffId },
        ),
      ).rejects.toThrow(/concierge/);
    } finally {
      await cleanupFixture(pool, propertyId);
    }
  }, 30_000);

  test('listPublic скрывает legal/contracts даже при is_public=true', async () => {
    if (!dbReady) return;
    const fixture = await seedFixture(pool);
    const { propertyId, staffId } = fixture;

    try {
      // Создаём 4 документа: rules+public, legal+public, contacts+draft,
      // safety+public (будет soft-deleted).
      const rules = await createDocument(
        pool,
        {
          propertyId,
          title: 'Правила',
          category: 'rules',
          bodyMd: 'rules body',
          isPublic: true,
          createdByStaffId: staffId,
        },
        { role: 'property_admin' },
      );
      const legal = await createDocument(
        pool,
        {
          propertyId,
          title: 'Legal',
          category: 'legal',
          bodyMd: 'legal body',
          isPublic: true, // даже при public — скрыт.
          createdByStaffId: staffId,
        },
        { role: 'property_admin' },
      );
      const contactsDraft = await createDocument(
        pool,
        {
          propertyId,
          title: 'Contacts draft',
          category: 'contacts',
          bodyMd: 'contacts body',
          isPublic: true,
          createdByStaffId: staffId,
        },
        { role: 'property_admin' },
      );
      const safety = await createDocument(
        pool,
        {
          propertyId,
          title: 'Safety',
          category: 'safety',
          bodyMd: 'safety body',
          isPublic: true,
          createdByStaffId: staffId,
        },
        { role: 'property_admin' },
      );

      // Публикуем rules / legal / safety.  contactsDraft остаётся draft.
      await publishDocument(pool, rules.id, { updatedByStaffId: staffId });
      await publishDocument(pool, legal.id, { updatedByStaffId: staffId });
      await publishDocument(pool, safety.id, { updatedByStaffId: staffId });

      // До soft-delete: listPublic видит rules + safety (legal скрыт по §3,
      // contactsDraft скрыт по published_at IS NULL).
      const pub1 = await listPublic(pool, propertyId);
      const titles1 = pub1.rows.map((r) => r.title).sort();
      expect(titles1).toEqual(['Правила', 'Safety']);

      // Soft-delete safety → listPublic уменьшается до одного.
      const del = await softDeleteDocument(pool, safety.id);
      expect(del.conflict).toBeNull();
      expect(del.row.deleted_at).not.toBeNull();

      const pub2 = await listPublic(pool, propertyId);
      expect(pub2.rows.map((r) => r.title)).toEqual(['Правила']);

      // Staff с include_deleted=true видит всё, кроме draft'а скрыт ещё и
      // под флагом include_draft.
      const staffNoFlags = await listForStaff(pool, propertyId, {});
      // без флагов: published + не удалённые = rules, legal (оба published
      // и не deleted), НЕ safety (deleted), НЕ contactsDraft (draft).
      const staffTitlesNoFlags = staffNoFlags.rows.map((r) => r.title).sort();
      expect(staffTitlesNoFlags).toEqual(['Legal', 'Правила']);

      const staffAll = await listForStaff(pool, propertyId, {
        includeDraft: true,
        includeDeleted: true,
      });
      expect(staffAll.rows).toHaveLength(4);
    } finally {
      await cleanupFixture(pool, propertyId);
    }
  }, 30_000);

  test('publish/unpublish идемпотентность + re-publish ставит свежий timestamp', async () => {
    if (!dbReady) return;
    const fixture = await seedFixture(pool);
    const { propertyId, staffId } = fixture;

    try {
      const doc = await createDocument(
        pool,
        {
          propertyId,
          title: 'Doc',
          category: 'rules',
          bodyMd: 'body',
          createdByStaffId: staffId,
        },
        { role: 'property_admin' },
      );

      // Первый publish — conflict null, published_at set.
      const p1 = await publishDocument(pool, doc.id, { updatedByStaffId: staffId });
      expect(p1.conflict).toBeNull();
      const firstPublishedAt = p1.row.published_at;
      expect(firstPublishedAt).not.toBeNull();

      // Второй publish — идемпотентен, conflict='already_published',
      // published_at НЕ перезаписан (spec §3 idempotent).
      const p2 = await publishDocument(pool, doc.id, { updatedByStaffId: staffId });
      expect(p2.conflict).toBe('already_published');
      expect(p2.row.published_at.toISOString()).toBe(firstPublishedAt.toISOString());

      // Unpublish.
      const u = await unpublishDocument(pool, doc.id, { updatedByStaffId: staffId });
      expect(u.conflict).toBeNull();
      expect(u.row.published_at).toBeNull();

      // Unpublish второй раз — not_published conflict.
      const u2 = await unpublishDocument(pool, doc.id, { updatedByStaffId: staffId });
      expect(u2.conflict).toBe('not_published');

      // Re-publish — свежий timestamp (>= первого).
      const p3 = await publishDocument(pool, doc.id, { updatedByStaffId: staffId });
      expect(p3.conflict).toBeNull();
      expect(p3.row.published_at.getTime()).toBeGreaterThanOrEqual(firstPublishedAt.getTime());
    } finally {
      await cleanupFixture(pool, propertyId);
    }
  }, 30_000);
});

// Helpers — applyV1Migrations / seedFixture / cleanupFixture — вынесены
// в ./_fixtures.js.  cleanupFixture удаляет document_versions + documents_v2.
