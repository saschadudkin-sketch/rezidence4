import type { QueryClient } from '@tanstack/react-query';
import { describe, expect, test, vi } from 'vitest';
import {
  invalidateContractorWorkspaceRequest,
  invalidateTechnicianWorkspaceRequest,
  qk,
} from './queryKeys';

function makeQueryClientSpy() {
  return {
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
  } as unknown as QueryClient & {
    invalidateQueries: ReturnType<typeof vi.fn>;
  };
}

describe('workspace query invalidators', () => {
  test('technician mutations invalidate canonical service request lifecycle', async () => {
    const qc = makeQueryClientSpy();

    await invalidateTechnicianWorkspaceRequest(qc, 'req-1');

    expect(qc.invalidateQueries).toHaveBeenCalledWith({
      queryKey: qk.technicianWorkspace.request('req-1'),
    });
    expect(qc.invalidateQueries).toHaveBeenCalledWith({
      queryKey: qk.serviceRequests.byId('req-1'),
    });
    expect(qc.invalidateQueries).toHaveBeenCalledWith({
      queryKey: qk.serviceRequests.lifecycle('req-1'),
    });
  });

  test('contractor mutations invalidate canonical service request lifecycle', async () => {
    const qc = makeQueryClientSpy();

    await invalidateContractorWorkspaceRequest(qc, 'req-1');

    expect(qc.invalidateQueries).toHaveBeenCalledWith({
      queryKey: qk.contractorWorkspace.request('req-1'),
    });
    expect(qc.invalidateQueries).toHaveBeenCalledWith({
      queryKey: qk.serviceRequests.byId('req-1'),
    });
    expect(qc.invalidateQueries).toHaveBeenCalledWith({
      queryKey: qk.serviceRequests.lifecycle('req-1'),
    });
  });
});
