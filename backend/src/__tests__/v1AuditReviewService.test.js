'use strict';

const {
  escalateOverdueSensitiveActionReviews,
  getSensitiveActionAntiAbuseAnalytics,
  listSensitiveActionReportEvidence,
  materializeSensitiveActionReviewSamples,
  recordSensitiveActionReportEvidence,
} = require('../v1/services/auditReviewService');

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111';

describe('auditReviewService DH-60 operations', () => {
  test('materializes sampled sensitive actions into review rows', async () => {
    const queryable = {
      query: jest.fn().mockResolvedValue({
        rows: [{ id: 'review-1', audit_log_id: 'audit-1', priority: 'urgent' }],
      }),
    };

    const rows = await materializeSensitiveActionReviewSamples({
      queryable,
      filters: { category: 'manual_override', property_id: PROPERTY_ID },
      options: { windowHours: 24, samplePercent: 100, dueHours: 48, limit: 20 },
    });

    expect(rows).toHaveLength(1);
    const [sql, params] = queryable.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO sensitive_action_reviews');
    expect(sql).toContain("sampled_by', 'dh60_rule'");
    expect(sql).toContain('random() < ($8::numeric / 100.0)');
    expect(sql).toContain('ON CONFLICT (audit_log_id) DO NOTHING');
    expect(params[0]).toEqual(expect.arrayContaining(['override.created']));
    expect(params[1]).toEqual(expect.arrayContaining(['manual_override']));
    expect(params).toEqual(expect.arrayContaining(['24', 100, 20, '48', PROPERTY_ID]));
  });

  test('escalates overdue pending reviews idempotently', async () => {
    const queryable = {
      query: jest.fn().mockResolvedValue({
        rows: [
          { id: 'review-1', escalation_status: 'overdue' },
          { id: 'review-2', escalation_status: 'escalated' },
        ],
      }),
    };

    const rows = await escalateOverdueSensitiveActionReviews({
      queryable,
      filters: { property_id: PROPERTY_ID },
      options: { limit: 10, escalateAfterHours: 12 },
    });

    expect(rows).toHaveLength(2);
    const [sql, params] = queryable.query.mock.calls[0];
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain("r.escalation_status = 'none'");
    expect(sql).toContain("THEN 'escalated'");
    expect(sql).toContain('last_escalated_at = NOW()');
    expect(sql).toContain('INSERT INTO notifications_outbox');
    expect(sql).toContain('audit.sensitive_review.escalated');
    expect(sql).toContain('escalation_notifications_enqueued');
    expect(params).toEqual(['12', 10, PROPERTY_ID]);
  });

  test('anti-abuse analytics maps actor/category hotspots with risk flags', async () => {
    const queryable = {
      query: jest.fn().mockResolvedValue({
        rows: [{
          actor_uid: 'guard-1',
          actor_role: 'security',
          category: 'manual_override',
          total_actions: 6,
          high_risk_actions: 6,
          pending_reviews: 3,
          overdue_reviews: 1,
          off_hours_actions: 2,
          distinct_resources: 4,
          first_seen_at: '2026-05-01T00:00:00.000Z',
          last_seen_at: '2026-05-02T00:00:00.000Z',
        }],
      }),
    };

    const result = await getSensitiveActionAntiAbuseAnalytics({
      queryable,
      filters: { property_id: PROPERTY_ID },
      options: { windowHours: 72, minActions: 5, limit: 25 },
    });

    expect(result.summary).toEqual({
      total_findings: 1,
      actors: 1,
      high_risk_actions: 6,
      overdue_reviews: 1,
    });
    expect(result.findings[0]).toMatchObject({
      actor_uid: 'guard-1',
      category: 'manual_override',
      flags: expect.arrayContaining(['high_volume', 'high_risk_category', 'off_hours', 'overdue_reviews']),
      risk_score: 25,
    });
    const [sql, params] = queryable.query.mock.calls[0];
    expect(sql).toContain('HAVING COUNT(*) >= $8');
    expect(sql).toContain('off_hours_actions');
    expect(sql).toContain('overdue_reviews');
    expect(params).toEqual(expect.arrayContaining(['72', 5, 25, PROPERTY_ID]));
  });

  test('records and lists live sensitive report evidence', async () => {
    const queryable = {
      query: jest.fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'report-1',
            property_id: PROPERTY_ID,
            report_type: 'anti_abuse',
            status: 'generated',
            period_from: '2026-05-01T00:00:00.000Z',
            period_to: '2026-05-11T00:00:00.000Z',
            summary: { findings: 2 },
            generated_by_uid: 'admin-1',
            created_at: '2026-05-11T01:00:00.000Z',
          }],
        })
        .mockResolvedValueOnce({
          rows: [{
            id: 'report-1',
            property_id: PROPERTY_ID,
            report_type: 'anti_abuse',
            status: 'generated',
            summary: { findings: 2 },
          }],
        }),
    };

    const recorded = await recordSensitiveActionReportEvidence({
      queryable,
      user: { uid: 'admin-1', role: 'admin', property_id: PROPERTY_ID },
      body: {
        report_type: 'anti_abuse',
        period_from: '2026-05-01T00:00:00.000Z',
        period_to: '2026-05-11T00:00:00.000Z',
        summary: { findings: 2 },
      },
    });
    const listed = await listSensitiveActionReportEvidence({
      queryable,
      filters: { property_id: PROPERTY_ID, report_type: 'anti_abuse' },
      limit: 10,
    });

    expect(recorded).toMatchObject({ report_type: 'anti_abuse', summary: { findings: 2 } });
    expect(listed).toHaveLength(1);
    expect(queryable.query.mock.calls[0][0]).toContain('INSERT INTO sensitive_action_report_evidence');
    expect(queryable.query.mock.calls[1][0]).toContain('FROM sensitive_action_report_evidence');
  });
});
