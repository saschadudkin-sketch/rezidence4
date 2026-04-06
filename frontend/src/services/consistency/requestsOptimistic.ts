export type RequestLike = {
  id: string;
  status?: string;
  updatedAt?: string;
  _optimisticOpId?: string;
};

type OperationType = 'delete' | 'cancel';

type OpLogEntry = {
  opId: string;
  type: OperationType;
  requestId: string;
  baseRevision: string;
};

export function createRequestsOptimisticController() {
  let seq = 0;
  const opLog = new Map<string, OpLogEntry>();

  const nextOpId = () => `op_${Date.now()}_${++seq}`;

  const revisionOf = (req?: RequestLike | null) =>
    req?.updatedAt || req?.status || 'unknown';

  function begin(type: OperationType, req: RequestLike) {
    const opId = nextOpId();
    opLog.set(opId, {
      opId,
      type,
      requestId: req.id,
      baseRevision: revisionOf(req),
    });
    return opId;
  }

  function end(opId: string) {
    opLog.delete(opId);
  }

  function shouldRollback(opId: string, current?: RequestLike | null) {
    const op = opLog.get(opId);
    if (!op) return false;
    if (!current) return true;
    if (current._optimisticOpId && current._optimisticOpId === opId) return true;
    return revisionOf(current) === op.baseRevision;
  }

  function size() {
    return opLog.size;
  }

  return { begin, end, shouldRollback, size };
}
