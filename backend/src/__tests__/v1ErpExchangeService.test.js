'use strict';

const {
  applyErpImport,
  createErpProviderConfig,
  exportErpDataset,
  previewErpImport,
} = require('../v1/services/erpExchangeService');

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111';
const PROVIDER_ID = '22222222-2222-4222-8222-222222222222';
const STAFF_ID = '33333333-3333-4333-8333-333333333333';
const JOB_ID = '44444444-4444-4444-8444-444444444444';
const MAPPING_ID = '55555555-5555-4555-8555-555555555555';

function makeQueryable(handler) {
  return { query: jest.fn(handler) };
}

function providerRow(overrides = {}) {
  return {
    id: PROVIDER_ID,
    property_id: PROPERTY_ID,
    provider: 'one_c_zhkh',
    display_name: '1C ЖКХ',
    status: 'active',
    sync_mode: 'import_only',
    base_url: 'https://1c.example/api',
    auth_ref: 'vault://erp/1c-main',
    config_json: {},
    capabilities: ['csv_import'],
    health_status: 'unknown',
    created_by: STAFF_ID,
    ...overrides,
  };
}

function jobRow(overrides = {}) {
  return {
    id: JOB_ID,
    property_id: PROPERTY_ID,
    provider_config_id: PROVIDER_ID,
    direction: 'import',
    dataset: 'resident_registry',
    source: 'csv',
    mode: 'dry_run',
    status: 'processing',
    summary: {},
    created_by: STAFF_ID,
    ...overrides,
  };
}

describe('ErpExchangeService', () => {
  test('creates ERP provider configs without inline secrets and aliases 1C providers', async () => {
    const queryable = makeQueryable((sql) => {
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: STAFF_ID }] });
      if (sql.includes('INSERT INTO erp_provider_configs')) return Promise.resolve({ rows: [providerRow()] });
      if (sql.includes('INSERT INTO property_audit_log')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const created = await createErpProviderConfig(queryable, {
      propertyId: PROPERTY_ID,
      user: { uid: 'admin-1', role: 'property_admin' },
      input: {
        provider: '1c_zhkh',
        display_name: '1C ЖКХ',
        base_url: 'https://operator:secret@1c.example/api',
        auth_ref: 'vault://erp/1c-main',
      },
    });

    expect(created).toMatchObject({ provider: 'one_c_zhkh' });
    const insert = queryable.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO erp_provider_configs'));
    expect(insert[1][1]).toBe('one_c_zhkh');
    expect(insert[1][5]).toBe('https://1c.example/api');
    expect(insert[1][8]).toContain('resident_registry_import');
    const audit = queryable.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO property_audit_log'));
    expect(audit[1][5]).toBe('integration.provider.configured');
  });

  test('rejects inline ERP secrets before writing provider config', async () => {
    const queryable = makeQueryable(() => Promise.resolve({ rows: [] }));

    await expect(createErpProviderConfig(queryable, {
      propertyId: PROPERTY_ID,
      user: { uid: 'admin-1', role: 'property_admin' },
      input: {
        provider: 'generic_rest',
        display_name: 'REST',
        config: { api_key: 'secret' },
      },
    })).rejects.toMatchObject({
      status: 400,
      message: 'config_json.api_key must use auth_ref, not inline secrets',
    });
    expect(queryable.query).not.toHaveBeenCalled();
  });

  test('previews resident import with row validation, duplicate conflict and no access grants', async () => {
    const queryable = makeQueryable((sql) => {
      if (sql.includes('FROM erp_provider_configs')) return Promise.resolve({ rows: [providerRow()] });
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: STAFF_ID }] });
      if (sql.includes('INSERT INTO erp_sync_jobs')) return Promise.resolve({ rows: [jobRow()] });
      if (sql.includes('FROM erp_external_mappings')) return Promise.resolve({ rows: [] });
      if (sql.includes('INSERT INTO erp_sync_records')) return Promise.resolve({ rows: [] });
      if (sql.includes('UPDATE erp_sync_jobs')) {
        return Promise.resolve({ rows: [jobRow({ status: 'partial', summary: { partial: true } })] });
      }
      if (sql.includes('INSERT INTO property_audit_log')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const result = await previewErpImport(queryable, {
      propertyId: PROPERTY_ID,
      providerConfigId: PROVIDER_ID,
      user: { uid: 'admin-1', role: 'property_admin' },
      input: {
        dataset: 'resident_registry',
        source: 'csv',
        rows: [
          { external_id: 'r-1', full_name: 'Ivan Petrov', unit_number: '12' },
          { external_id: 'r-1', full_name: 'Ivan Petrov Copy', unit_number: '12' },
          { external_id: 'r-2', unit_number: '14' },
        ],
      },
    });

    expect(result.summary).toMatchObject({
      total: 3,
      valid: 1,
      invalid: 1,
      conflicts: 1,
      access_grants_created: 0,
      mapping_only: true,
    });
    const mappingWrite = queryable.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO erp_external_mappings'));
    expect(mappingWrite).toBeUndefined();
    const updateJob = queryable.query.mock.calls.find(([sql]) => sql.includes('UPDATE erp_sync_jobs'));
    expect(updateJob[0]).toContain('AND property_id = $5');
    expect(updateJob[1][4]).toBe(PROPERTY_ID);
    const audit = queryable.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO property_audit_log'));
    expect(audit[1][5]).toBe('erp.import.previewed');
  });

  test('fails preview when scoped sync job completion does not update a row', async () => {
    const queryable = makeQueryable((sql) => {
      if (sql.includes('FROM erp_provider_configs')) return Promise.resolve({ rows: [providerRow()] });
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: STAFF_ID }] });
      if (sql.includes('INSERT INTO erp_sync_jobs')) return Promise.resolve({ rows: [jobRow()] });
      if (sql.includes('FROM erp_external_mappings')) return Promise.resolve({ rows: [] });
      if (sql.includes('INSERT INTO erp_sync_records')) return Promise.resolve({ rows: [] });
      if (sql.includes('UPDATE erp_sync_jobs')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    await expect(previewErpImport(queryable, {
      propertyId: PROPERTY_ID,
      providerConfigId: PROVIDER_ID,
      user: { uid: 'admin-1', role: 'property_admin' },
      input: {
        dataset: 'resident_registry',
        source: 'csv',
        rows: [{ external_id: 'r-1', full_name: 'Ivan Petrov', unit_number: '12' }],
      },
    })).rejects.toMatchObject({
      status: 409,
      message: 'ERP sync job changed; refresh and retry',
    });

    expect(queryable.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO property_audit_log'))).toBe(false);
  });

  test('applies import as external-ID mapping only and records no DomHub access grant', async () => {
    const queryable = makeQueryable((sql) => {
      if (sql.includes('FROM erp_provider_configs')) return Promise.resolve({ rows: [providerRow()] });
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: STAFF_ID }] });
      if (sql.includes('INSERT INTO erp_sync_jobs')) return Promise.resolve({ rows: [jobRow({ mode: 'apply' })] });
      if (sql.includes('FROM erp_external_mappings')) return Promise.resolve({ rows: [] });
      if (sql.includes('INSERT INTO erp_external_mappings')) {
        return Promise.resolve({
          rows: [{
            id: MAPPING_ID,
            property_id: PROPERTY_ID,
            provider_config_id: PROVIDER_ID,
            external_entity_type: 'resident',
            external_id: 'r-1',
            conflict_status: 'unmapped',
          }],
        });
      }
      if (sql.includes('INSERT INTO erp_sync_records')) return Promise.resolve({ rows: [] });
      if (sql.includes('UPDATE erp_sync_jobs')) {
        return Promise.resolve({ rows: [jobRow({ mode: 'apply', status: 'completed', summary: { total: 1 } })] });
      }
      if (sql.includes('INSERT INTO property_audit_log')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const result = await applyErpImport(queryable, {
      propertyId: PROPERTY_ID,
      providerConfigId: PROVIDER_ID,
      user: { uid: 'admin-1', role: 'property_admin' },
      input: {
        dataset: 'resident_registry',
        source: 'csv',
        rows: [{ external_id: 'r-1', full_name: 'Ivan Petrov', unit_number: '12' }],
      },
    });

    expect(result.summary).toMatchObject({
      applied: 1,
      access_grants_created: 0,
      mapping_only: true,
    });
    const mappingInsert = queryable.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO erp_external_mappings'));
    expect(mappingInsert[1][2]).toBe('resident');
    expect(mappingInsert[1][7]).toBe('unmapped');
    const recordInsert = queryable.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO erp_sync_records'));
    expect(JSON.parse(recordInsert[1][12])).toMatchObject({
      access_grant_created: false,
      domhub_mutation_applied: false,
    });
  });

  test('exports incident summary as JSON payload and audits export generation', async () => {
    const incident = {
      id: '66666666-6666-4666-8666-666666666666',
      incident_type: 'provider_conflict',
      severity: 'medium',
      status: 'open',
      title: 'Provider conflict',
    };
    const queryable = makeQueryable((sql) => {
      if (sql.includes('FROM erp_provider_configs')) return Promise.resolve({ rows: [providerRow()] });
      if (sql.includes('FROM staff_users')) return Promise.resolve({ rows: [{ id: STAFF_ID }] });
      if (sql.includes('INSERT INTO erp_sync_jobs')) {
        return Promise.resolve({ rows: [jobRow({ direction: 'export', dataset: 'incident_summary' })] });
      }
      if (sql.includes('FROM access_incidents')) return Promise.resolve({ rows: [incident] });
      if (sql.includes('UPDATE erp_sync_jobs')) {
        return Promise.resolve({
          rows: [jobRow({ direction: 'export', dataset: 'incident_summary', status: 'completed' })],
        });
      }
      if (sql.includes('INSERT INTO property_audit_log')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const result = await exportErpDataset(queryable, {
      propertyId: PROPERTY_ID,
      providerConfigId: PROVIDER_ID,
      user: { uid: 'admin-1', role: 'property_admin' },
      input: { dataset: 'incident_summary', source: 'manual', limit: 10 },
    });

    expect(result.records).toEqual([incident]);
    expect(result.summary).toMatchObject({
      dataset: 'incident_summary',
      total: 1,
      no_financial_payload: true,
    });
    const exportSql = queryable.query.mock.calls.find(([sql]) => sql.includes('FROM access_incidents'));
    expect(exportSql[0]).toContain('property_id = $1');
    const audit = queryable.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO property_audit_log'));
    expect(audit[1][5]).toBe('erp.export.generated');
  });
});
