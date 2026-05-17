import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  getMock,
  postMock,
} = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
}));

vi.mock('./client', () => ({
  v1Client: {
    get: getMock,
    post: postMock,
  },
}));

import { auditReviewsApi } from './auditReviews';

describe('auditReviewsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('routes report evidence reads and writes through canonical v1 endpoints', async () => {
    getMock.mockResolvedValue({});
    postMock.mockResolvedValue({});

    await auditReviewsApi.listReportEvidence({
      property_id: 'property-1',
      report_type: 'live_rollout',
      status: 'generated',
      limit: 10,
    });
    await auditReviewsApi.recordReportEvidence({
      property_id: 'property-1',
      report_type: 'live_rollout',
      summary: { reviewers: 2 },
    });

    expect(getMock).toHaveBeenCalledWith(
      '/audit/sensitive-actions/_report-evidence?property_id=property-1&report_type=live_rollout&status=generated&limit=10',
      undefined,
    );
    expect(postMock).toHaveBeenCalledWith(
      '/audit/sensitive-actions/_report-evidence',
      {
        property_id: 'property-1',
        report_type: 'live_rollout',
        summary: { reviewers: 2 },
      },
      undefined,
    );
  });

  test('allows report evidence camelCase payload aliases accepted by backend', async () => {
    postMock.mockResolvedValue({});

    await auditReviewsApi.recordReportEvidence({
      propertyId: 'property-1',
      reportType: 'attestation',
      periodFrom: '2026-05-01T00:00:00.000Z',
      periodTo: '2026-05-31T23:59:59.000Z',
      status: 'reviewed',
      summary: { reviewed: true },
    });

    expect(postMock).toHaveBeenCalledWith(
      '/audit/sensitive-actions/_report-evidence',
      {
        propertyId: 'property-1',
        reportType: 'attestation',
        periodFrom: '2026-05-01T00:00:00.000Z',
        periodTo: '2026-05-31T23:59:59.000Z',
        status: 'reviewed',
        summary: { reviewed: true },
      },
      undefined,
    );
  });

  test('routes sampling and escalation jobs through canonical v1 endpoints', async () => {
    postMock.mockResolvedValue({});

    await auditReviewsApi.sample({
      property_id: 'property-1',
      category: 'manual_override',
      window_hours: 24,
      sample_percent: 100,
      due_hours: 48,
      limit: 20,
    });
    await auditReviewsApi.escalate({
      property_id: 'property-1',
      limit: 10,
      escalate_after_hours: 12,
    });

    expect(postMock).toHaveBeenNthCalledWith(
      1,
      '/audit/sensitive-actions/_sample',
      {
        property_id: 'property-1',
        category: 'manual_override',
        window_hours: 24,
        sample_percent: 100,
        due_hours: 48,
        limit: 20,
      },
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      2,
      '/audit/sensitive-actions/_escalate',
      {
        property_id: 'property-1',
        limit: 10,
        escalate_after_hours: 12,
      },
      undefined,
    );
  });

  test('routes review assignment and attestation through encoded audit ids', async () => {
    postMock.mockResolvedValue({});

    await auditReviewsApi.assign('audit/1', {
      assigned_reviewer_staff_id: 'staff-1',
      priority: 'urgent',
      reason: 'weekly override sample',
    });
    await auditReviewsApi.review('audit/1', {
      decision: 'approved',
      comment: 'checked',
    });

    expect(postMock).toHaveBeenNthCalledWith(
      1,
      '/audit/sensitive-actions/audit%2F1/assign',
      {
        assigned_reviewer_staff_id: 'staff-1',
        priority: 'urgent',
        reason: 'weekly override sample',
      },
      undefined,
    );
    expect(postMock).toHaveBeenNthCalledWith(
      2,
      '/audit/sensitive-actions/audit%2F1/review',
      {
        decision: 'approved',
        comment: 'checked',
      },
      undefined,
    );
  });
});
