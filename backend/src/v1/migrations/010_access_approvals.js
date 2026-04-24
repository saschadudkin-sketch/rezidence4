'use strict';

// platform-v1 property-DB migration 010 — access_approvals (Фаза 3 Access-core).
// Spec: docs/product/specs/platform-v1/access-requests-spec.md §2.
//
// Решения по заявкам в отдельной таблице — даёт (а) аудит «кто и когда»,
// (б) возможность co-approval (несколько approver'ов на одну заявку), (в)
// escalation (decision='escalated' = подняли наверх, одобрения ещё нет).
//
// В legacy решения жили как строки `request_history(req_id, label='approved'/'rejected')`
// без типизации ролей. Здесь разделяем approver_type + nullable FK на staff vs
// resident (co-approval резидентами — спрятано schemaтически, UX пост-релиз).
//
// CHECK не форсирует «только один approver_*_id», т.к. approver_type может
// быть 'resident' с NULL staff_id и т.д.  Проверка exclusive — в сервисе.

module.exports = {
  id: 'v1_010_access_approvals',
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS access_approvals (
        id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        access_request_id       UUID NOT NULL REFERENCES access_requests(id) ON DELETE CASCADE,
        approver_type           VARCHAR(20) NOT NULL
                                CHECK (approver_type IN ('resident','staff')),
        approver_staff_id       UUID REFERENCES staff_users(id) ON DELETE RESTRICT,
        approver_resident_id    UUID REFERENCES residents(id) ON DELETE RESTRICT,
        decision                VARCHAR(20) NOT NULL
                                CHECK (decision IN ('approved','rejected','escalated')),
        comment                 TEXT,
        created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT access_approvals_approver_consistent CHECK (
          (approver_type = 'staff'    AND approver_staff_id    IS NOT NULL AND approver_resident_id IS NULL)
          OR (approver_type = 'resident' AND approver_resident_id IS NOT NULL AND approver_staff_id    IS NULL)
        )
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_access_approvals_request
        ON access_approvals(access_request_id, created_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_access_approvals_staff
        ON access_approvals(approver_staff_id, created_at DESC)
        WHERE approver_staff_id IS NOT NULL
    `);
  },
};
