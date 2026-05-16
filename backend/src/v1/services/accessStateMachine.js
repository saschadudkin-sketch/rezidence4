'use strict';

class StateTransitionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StateTransitionError';
    this.status = 409;
  }
}

const ACCESS_REQUEST_ACTION_ALLOWED = Object.freeze({
  approve: new Set(['pending_approval', 'escalated']),
  reject: new Set(['pending_approval', 'escalated']),
  escalate: new Set(['pending_approval']),
  cancel: new Set(['new', 'pending_approval', 'escalated', 'approved']),
});

const PASS_ACTION_ALLOWED = Object.freeze({
  use: new Set(['active']),
  revoke: new Set(['active', 'used', 'blocked']),
  block: new Set(['active', 'used', 'blocked']),
  unblock: new Set(['blocked']),
  expire: new Set(['active']),
  qr: new Set(['active']),
  regenerate_qr: new Set(['active']),
  pin: new Set(['active']),
  regenerate_pin: new Set(['active']),
});

const INCIDENT_ACTION_ALLOWED = Object.freeze({
  assign: new Set(['open', 'investigating']),
  reopen: new Set(['resolved', 'dismissed']),
  resolve: new Set(['open', 'investigating']),
  dismiss: new Set(['open', 'investigating']),
});

function assertAccessRequestAction(status, action) {
  const allowed = ACCESS_REQUEST_ACTION_ALLOWED[action];
  if (!allowed || !allowed.has(status)) {
    throw new StateTransitionError(`Cannot ${action} from status '${status}'`);
  }
}

function assertPassAction(status, action) {
  const allowed = PASS_ACTION_ALLOWED[action];
  if (allowed && allowed.has(status)) return;

  if (action === 'revoke') {
    if (status === 'revoked') throw new StateTransitionError('Pass already revoked');
    throw new StateTransitionError(`Cannot revoke pass in status '${status}'`);
  }

  if (action === 'block') {
    throw new StateTransitionError(`Cannot block pass in status '${status}'`);
  }

  if (action === 'unblock') {
    throw new StateTransitionError(`Pass is not blocked (status='${status}')`);
  }

  if (action === 'qr' || action === 'regenerate_qr' || action === 'pin' || action === 'regenerate_pin') {
    const credential = action.includes('pin') ? 'PIN' : 'QR';
    const verb = action === 'qr' || action === 'pin' ? 'fetch' : 'regenerate';
    throw new StateTransitionError(`Cannot ${verb} ${credential} for pass in status '${status}'`);
  }

  throw new StateTransitionError(`Cannot ${action} pass in status '${status}'`);
}

function assertIncidentAction(status, action) {
  const allowed = INCIDENT_ACTION_ALLOWED[action];
  if (allowed && allowed.has(status)) return;

  if (action === 'assign') {
    throw new StateTransitionError(`Cannot assign in status '${status}'`);
  }
  if (action === 'reopen') {
    throw new StateTransitionError(`Cannot reopen incident in status '${status}'`);
  }
  if (status === 'resolved' || status === 'dismissed') {
    throw new StateTransitionError(`Incident already ${status}`);
  }
  throw new StateTransitionError(`Cannot ${action} incident in status '${status}'`);
}

module.exports = {
  ACCESS_REQUEST_ACTION_ALLOWED,
  INCIDENT_ACTION_ALLOWED,
  PASS_ACTION_ALLOWED,
  StateTransitionError,
  assertAccessRequestAction,
  assertIncidentAction,
  assertPassAction,
};
