import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ScanPanel, extractQrTokenForVerify } from './ScanPanel';

const {
  listPointsMock,
  manualDecisionMock,
  offlineReplayMock,
  verifyMock,
} = vi.hoisted(() => ({
  listPointsMock: vi.fn(),
  manualDecisionMock: vi.fn(),
  offlineReplayMock: vi.fn(),
  verifyMock: vi.fn(),
}));

vi.mock('../api/accessTopology', () => ({
  accessTopologyApi: {
    listPoints: listPointsMock,
  },
}));

vi.mock('../api/securityWorkspace', () => ({
  securityWorkspaceApi: {
    manualDecision: manualDecisionMock,
    offlineReplay: offlineReplayMock,
  },
}));

vi.mock('../api/visits', () => ({
  visitsApi: {
    verify: verifyMock,
  },
}));

const propertyId = '11111111-1111-1111-1111-111111111111';
const accessPointId = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  listPointsMock.mockResolvedValue({
    points: [{
      id: accessPointId,
      property_id: propertyId,
      zone_id: null,
      name: 'КПП Север',
      point_type: 'gate',
      provider: null,
      provider_external_id: null,
      description: null,
      sort_order: 0,
      is_active: true,
      metadata: {},
      created_at: '2026-05-16T10:00:00.000Z',
      updated_at: '2026-05-16T10:00:00.000Z',
    }],
  });
  verifyMock.mockResolvedValue({
    allowed: true,
    reason: undefined,
    direction: 'entry',
    visit_log_id: '33333333-3333-3333-3333-333333333333',
    incident_id: null,
    pass: null,
  });
});

describe('ScanPanel QR input', () => {
  test('extracts raw token from public pass URLs', () => {
    const token = 'a'.repeat(32);

    expect(extractQrTokenForVerify(token)).toBe(token);
    expect(extractQrTokenForVerify(`https://domhub.su/p/${token}`)).toBe(token);
    expect(extractQrTokenForVerify(`/p/${token}?utm=guest`)).toBe(token);
  });

  test('verifies QR public URL by sending only token to v1 verify endpoint', async () => {
    const onVerified = vi.fn();
    const token = 'b'.repeat(32);

    render(<ScanPanel propertyId={propertyId} onVerified={onVerified} />);

    await waitFor(() => expect(listPointsMock).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('QR-токен'), {
      target: { value: `https://domhub.su/p/${token}` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Проверить' }));

    await waitFor(() => expect(verifyMock).toHaveBeenCalled());
    expect(verifyMock).toHaveBeenCalledWith({
      property_id: propertyId,
      mode: 'qr',
      token,
      access_point_id: accessPointId,
      direction: 'entry',
    });
    expect(onVerified).toHaveBeenCalledWith(expect.objectContaining({ allowed: true }), {
      mode: 'qr',
      value: token,
      access_point_id: accessPointId,
      direction: 'entry',
    });
  });
});
