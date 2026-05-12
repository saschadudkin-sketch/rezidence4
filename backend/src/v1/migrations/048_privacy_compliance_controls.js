'use strict';

// DH-56 RU personal data compliance controls.
//
// Adds an auditable DSAR workflow and per-property compliance evidence ledger
// for retention, localization/ISPDn readiness and no-biometrics release guards.

function addConstraintIfMissing(name, sql) {
  return `
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = '${name}'
      ) THEN
        ${sql}
      END IF;
    END $$;
  `;
}

module.exports = {
  id: 'v1_048_privacy_compliance_controls',
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS privacy_data_subject_requests (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id         UUID NOT NULL,
        request_type        VARCHAR(20) NOT NULL,
        status              VARCHAR(30) NOT NULL DEFAULT 'pending',
        subject_uid         TEXT,
        subject_resident_id UUID REFERENCES residents(id) ON DELETE SET NULL,
        submitted_by_uid    TEXT,
        submitted_by_role   TEXT,
        request_payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
        due_at              TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
        processed_by_uid    TEXT,
        processed_at        TIMESTAMPTZ,
        resolution_note     TEXT,
        export_payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
        retention_decision  JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT privacy_data_subject_requests_subject CHECK (
          subject_uid IS NOT NULL OR subject_resident_id IS NOT NULL
        ),
        CONSTRAINT privacy_data_subject_requests_processed_state CHECK (
          status NOT IN ('completed','rejected','cancelled')
          OR processed_at IS NOT NULL
        )
      )
    `);

    await client.query(addConstraintIfMissing(
      'privacy_data_subject_requests_type_check',
      `ALTER TABLE privacy_data_subject_requests
         ADD CONSTRAINT privacy_data_subject_requests_type_check
         CHECK (request_type IN ('export','delete','correct','restrict'));`,
    ));

    await client.query(addConstraintIfMissing(
      'privacy_data_subject_requests_status_check',
      `ALTER TABLE privacy_data_subject_requests
         ADD CONSTRAINT privacy_data_subject_requests_status_check
         CHECK (status IN ('pending','in_progress','completed','rejected','cancelled'));`,
    ));

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_privacy_dsr_property_status
        ON privacy_data_subject_requests(property_id, status, due_at, created_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_privacy_dsr_subject_uid
        ON privacy_data_subject_requests(property_id, subject_uid, created_at DESC)
        WHERE subject_uid IS NOT NULL
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_privacy_dsr_subject_resident
        ON privacy_data_subject_requests(property_id, subject_resident_id, created_at DESC)
        WHERE subject_resident_id IS NOT NULL
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS privacy_compliance_evidence (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id     UUID NOT NULL,
        evidence_type   VARCHAR(50) NOT NULL,
        status          VARCHAR(30) NOT NULL DEFAULT 'ready',
        summary         TEXT,
        artifact_uri    TEXT,
        evidence        JSONB NOT NULL DEFAULT '{}'::jsonb,
        recorded_by_uid TEXT,
        reviewed_at     TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(addConstraintIfMissing(
      'privacy_compliance_evidence_type_check',
      `ALTER TABLE privacy_compliance_evidence
         ADD CONSTRAINT privacy_compliance_evidence_type_check
         CHECK (evidence_type IN (
           'dsar_workflow',
           'retention_sweep',
           'data_localization',
           'ispdn_readiness',
           'no_biometrics_release_guard',
           'consent_history',
           'deletion_procedure'
         ));`,
    ));

    await client.query(addConstraintIfMissing(
      'privacy_compliance_evidence_status_check',
      `ALTER TABLE privacy_compliance_evidence
         ADD CONSTRAINT privacy_compliance_evidence_status_check
         CHECK (status IN ('draft','ready','reviewed','blocked'));`,
    ));

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_privacy_compliance_evidence_property
        ON privacy_compliance_evidence(property_id, evidence_type, created_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_privacy_compliance_evidence_status
        ON privacy_compliance_evidence(property_id, status, created_at DESC)
    `);
  },
};
