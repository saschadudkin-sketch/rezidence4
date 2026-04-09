import { describe, expect, it } from 'vitest';
import { createRequestsOptimisticController } from './requestsOptimistic';

describe('requests optimistic consistency controller', () => {
  it('rolls back when entity still belongs to current optimistic op', () => {
    const ctl = createRequestsOptimisticController();
    const opId = ctl.begin('cancel', { id: 'r1', status: 'pending', updatedAt: '2026-04-01T10:00:00Z' });

    expect(ctl.shouldRollback(opId, { id: 'r1', status: 'cancelled', _optimisticOpId: opId })).toBe(true);
  });

  it('does not roll back if fresher revision already arrived from server', () => {
    const ctl = createRequestsOptimisticController();
    const opId = ctl.begin('cancel', { id: 'r1', status: 'pending', updatedAt: '2026-04-01T10:00:00Z' });

    expect(ctl.shouldRollback(opId, { id: 'r1', status: 'approved', updatedAt: '2026-04-01T10:05:00Z' })).toBe(false);
  });

  it('allows restoring deleted row when it is still absent after failure', () => {
    const ctl = createRequestsOptimisticController();
    const opId = ctl.begin('delete', { id: 'r1', status: 'pending', updatedAt: '2026-04-01T10:00:00Z' });

    expect(ctl.shouldRollback(opId, null)).toBe(true);
  });
});
