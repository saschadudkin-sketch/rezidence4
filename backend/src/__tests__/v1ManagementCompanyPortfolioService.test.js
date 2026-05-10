'use strict';

const {
  describe, test, expect, jest: jestApi,
} = require('@jest/globals');

const {
  getManagementCompanyPortfolio,
  listPortfolioProperties,
} = require('../v1/services/managementCompanyPortfolio');

const MC_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const alpha = {
  id: '11111111-1111-1111-1111-111111111111',
  slug: 'alpha',
  name: 'Alpha Residence',
  status: 'active',
  is_active: true,
  db_connection_url: 'postgres://alpha',
  management_company_id: MC_ID,
};

const beta = {
  id: '22222222-2222-2222-2222-222222222222',
  slug: 'beta',
  name: 'Beta Village',
  status: 'active',
  is_active: true,
  db_connection_url: 'postgres://beta',
  management_company_id: MC_ID,
};

function makePlatformDb(rows) {
  return {
    query: jestApi.fn(async () => ({ rows })),
  };
}

function dashboard(overrides = {}) {
  return {
    generated_at: '2026-05-10T00:00:00.000Z',
    requests: {
      created: 0,
      completed: 0,
      open: 0,
      overdue_backlog: 0,
      resolved_within_sla: 0,
      resolved_with_sla: 0,
      sla_compliance_rate: null,
      by_status: [],
      by_priority: [],
      ...overrides.requests,
    },
    access: {
      requests_created: 0,
      requests_approved: 0,
      requests_rejected: 0,
      approval_rate: null,
      pending: 0,
      expired: 0,
      allow_count: 0,
      denial_count: 0,
      vehicle_traffic_count: 0,
      active_passes: 0,
      used_passes: 0,
      ...overrides.access,
    },
    incidents: {
      open: 0,
      investigating: 0,
      closed: 0,
      high_priority_open: 0,
      blacklist_hits: 0,
      suspicious_attempts: 0,
      by_type: [],
      ...overrides.incidents,
    },
    notifications: {
      sent: 0,
      failed: 0,
      success_rate: null,
      queue: { pending: 0, in_flight: 0, sent: 0, failed: 0, dead: 0 },
      oldest_pending_age_seconds: null,
      per_channel: [],
      ...overrides.notifications,
    },
  };
}

describe('listPortfolioProperties', () => {
  test('rejects requested property slugs outside the management company scope', async () => {
    const platformDb = makePlatformDb([alpha]);

    await expect(listPortfolioProperties(platformDb, {
      managementCompanyId: MC_ID,
      propertySlugs: ['alpha', 'outside'],
    })).rejects.toMatchObject({
      statusCode: 403,
      code: 'PROPERTY_FILTER_OUTSIDE_PORTFOLIO',
      details: { property_slugs: ['outside'] },
    });
  });

  test('requires management company id and platform db', async () => {
    await expect(listPortfolioProperties(null, { managementCompanyId: MC_ID }))
      .rejects.toThrow(/platformDb/);
    await expect(listPortfolioProperties(makePlatformDb([]), {}))
      .rejects.toMatchObject({ statusCode: 400, code: 'MANAGEMENT_COMPANY_REQUIRED' });
  });
});

describe('getManagementCompanyPortfolio', () => {
  test('rolls up DH-35 property snapshots with weighted rates and hotspots', async () => {
    const platformDb = makePlatformDb([alpha, beta]);
    const getPropertyPool = jestApi.fn((property) => ({ slug: property.slug }));
    const fetchPropertyDashboard = jestApi.fn(async (_pool, opts) => {
      if (opts.propertyId === alpha.id) {
        return dashboard({
          requests: {
            created: 5,
            completed: 2,
            open: 3,
            overdue_backlog: 1,
            resolved_within_sla: 3,
            resolved_with_sla: 4,
            by_status: [{ status: 'open', total: 3 }],
            by_priority: [{ priority: 'emergency', total: 1 }],
          },
          access: {
            requests_created: 4,
            requests_approved: 3,
            requests_rejected: 1,
            pending: 2,
            allow_count: 20,
            denial_count: 2,
            vehicle_traffic_count: 12,
            active_passes: 7,
          },
          incidents: {
            open: 2,
            investigating: 1,
            high_priority_open: 1,
            blacklist_hits: 1,
            by_type: [{ incident_type: 'blacklist_hit', total: 1 }],
          },
          notifications: {
            sent: 90,
            failed: 10,
            success_rate: 0.9,
            queue: { pending: 1, in_flight: 0, sent: 100, failed: 1, dead: 0 },
            oldest_pending_age_seconds: 55,
            per_channel: [{ channel: 'sms', sent: 40, failed: 10 }],
          },
        });
      }
      return dashboard({
        requests: {
          created: 3,
          completed: 1,
          open: 1,
          overdue_backlog: 0,
          resolved_within_sla: 1,
          resolved_with_sla: 2,
          by_status: [{ status: 'open', total: 1 }],
          by_priority: [{ priority: 'normal', total: 3 }],
        },
        access: {
          requests_created: 2,
          requests_approved: 1,
          requests_rejected: 1,
          allow_count: 5,
          denial_count: 1,
          vehicle_traffic_count: 2,
          active_passes: 4,
        },
        incidents: {
          open: 1,
          investigating: 0,
          high_priority_open: 0,
          by_type: [{ incident_type: 'manual_override', total: 2 }],
        },
        notifications: {
          sent: 45,
          failed: 5,
          success_rate: 0.9,
          queue: { pending: 2, in_flight: 1, sent: 50, failed: 0, dead: 1 },
          oldest_pending_age_seconds: 90,
          per_channel: [{ channel: 'sms', sent: 45, failed: 5 }],
        },
      });
    });

    const out = await getManagementCompanyPortfolio({
      platformDb,
      managementCompanyId: MC_ID,
      period: { key: '7d', hours: 168 },
      getPropertyPool,
      fetchPropertyDashboard,
      logger: { warn: jestApi.fn() },
    });

    expect(platformDb.query).toHaveBeenCalledWith(expect.stringContaining('management_company_id = $1'), [
      MC_ID,
      false,
    ]);
    expect(getPropertyPool).toHaveBeenCalledTimes(2);
    expect(fetchPropertyDashboard).toHaveBeenCalledWith({ slug: 'alpha' }, {
      propertyId: alpha.id,
      period: '7d',
    });
    expect(out.rollup).toMatchObject({
      properties_total: 2,
      properties_healthy: 2,
      properties_error: 0,
      hotspot_property_count: 2,
      requests: {
        created: 8,
        completed: 3,
        open: 4,
        overdue_backlog: 1,
        resolved_within_sla: 4,
        resolved_with_sla: 6,
      },
      access: {
        requests_created: 6,
        requests_approved: 4,
        requests_rejected: 2,
        allow_count: 25,
        denial_count: 3,
        vehicle_traffic_count: 14,
      },
      incidents: {
        open: 3,
        investigating: 1,
        high_priority_open: 1,
      },
      notifications: {
        sent: 135,
        failed: 15,
        queue: {
          pending: 3,
          in_flight: 1,
          sent: 150,
          failed: 1,
          dead: 1,
        },
        oldest_pending_age_seconds: 90,
      },
    });
    expect(out.rollup.requests.sla_compliance_rate).toBeCloseTo(4 / 6);
    expect(out.rollup.access.approval_rate).toBeCloseTo(4 / 6);
    expect(out.rollup.notifications.success_rate).toBeCloseTo(135 / 150);
    expect(out.rollup.requests.by_status).toEqual([{ status: 'open', total: 4 }]);
    expect(out.rollup.notifications.per_channel).toEqual([
      {
        channel: 'sms',
        sent: 85,
        failed: 15,
        success_rate: 0.85,
      },
    ]);
    expect(out.rankings.overdue_backlog[0]).toMatchObject({
      property_slug: 'alpha',
      value: 1,
    });
  });

  test('isolates per-property failures and still returns healthy portfolio totals', async () => {
    const logger = { warn: jestApi.fn() };
    const broken = {
      ...beta,
      db_connection_url: null,
    };
    const out = await getManagementCompanyPortfolio({
      platformDb: makePlatformDb([alpha, broken]),
      managementCompanyId: MC_ID,
      period: { key: '24h', hours: 24 },
      getPropertyPool: jestApi.fn((property) => ({ slug: property.slug })),
      fetchPropertyDashboard: jestApi.fn(async () => dashboard({
        requests: { created: 2, resolved_within_sla: 1, resolved_with_sla: 1 },
        notifications: { sent: 10, failed: 0, queue: {}, per_channel: [] },
      })),
      logger,
    });

    expect(out.rollup.properties_total).toBe(2);
    expect(out.rollup.properties_healthy).toBe(1);
    expect(out.rollup.properties_error).toBe(1);
    expect(out.errors).toEqual([
      {
        property_id: beta.id,
        property_slug: 'beta',
        error: 'property has no db_connection_url',
      },
    ]);
    expect(logger.warn).toHaveBeenCalled();
  });
});
