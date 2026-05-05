'use strict';

const {
  StateTransitionError,
  assertAccessRequestAction,
  assertIncidentAction,
  assertPassAction,
} = require('../v1/services/accessStateMachine');

function expectConflict(fn, message) {
  try {
    fn();
    throw new Error('expected transition to fail');
  } catch (err) {
    expect(err).toBeInstanceOf(StateTransitionError);
    expect(err).toMatchObject({ status: 409, message });
  }
}

describe('access state machine', () => {
  test('access requests only allow approval actions from pending/escalated review states', () => {
    expect(() => assertAccessRequestAction('pending_approval', 'approve')).not.toThrow();
    expect(() => assertAccessRequestAction('escalated', 'approve')).not.toThrow();
    expect(() => assertAccessRequestAction('pending_approval', 'reject')).not.toThrow();
    expect(() => assertAccessRequestAction('escalated', 'reject')).not.toThrow();
    expect(() => assertAccessRequestAction('pending_approval', 'escalate')).not.toThrow();

    expectConflict(
      () => assertAccessRequestAction('new', 'approve'),
      "Cannot approve from status 'new'",
    );
    expectConflict(
      () => assertAccessRequestAction('rejected', 'approve'),
      "Cannot approve from status 'rejected'",
    );
    expectConflict(
      () => assertAccessRequestAction('escalated', 'escalate'),
      "Cannot escalate from status 'escalated'",
    );
  });

  test('access request cancellation is allowed before terminal states only', () => {
    for (const status of ['new', 'pending_approval', 'escalated', 'approved']) {
      expect(() => assertAccessRequestAction(status, 'cancel')).not.toThrow();
    }

    for (const status of ['rejected', 'cancelled', 'expired']) {
      expectConflict(
        () => assertAccessRequestAction(status, 'cancel'),
        `Cannot cancel from status '${status}'`,
      );
    }
  });

  test('passes enforce active/blocked lifecycle actions', () => {
    expect(() => assertPassAction('active', 'use')).not.toThrow();
    expect(() => assertPassAction('active', 'expire')).not.toThrow();
    for (const status of ['active', 'used', 'blocked']) {
      expect(() => assertPassAction(status, 'revoke')).not.toThrow();
      expect(() => assertPassAction(status, 'block')).not.toThrow();
      expect(() => assertPassAction(status, 'qr')).not.toThrow();
      expect(() => assertPassAction(status, 'regenerate_qr')).not.toThrow();
    }
    expect(() => assertPassAction('blocked', 'unblock')).not.toThrow();

    expectConflict(
      () => assertPassAction('used', 'use'),
      "Cannot use pass in status 'used'",
    );
    expectConflict(
      () => assertPassAction('revoked', 'revoke'),
      'Pass already revoked',
    );
    expectConflict(
      () => assertPassAction('expired', 'block'),
      "Cannot block pass in status 'expired'",
    );
    expectConflict(
      () => assertPassAction('active', 'unblock'),
      "Pass is not blocked (status='active')",
    );
    expectConflict(
      () => assertPassAction('expired', 'unblock'),
      "Pass is not blocked (status='expired')",
    );
    expectConflict(
      () => assertPassAction('revoked', 'qr'),
      "Cannot fetch QR for pass in status 'revoked'",
    );
    expectConflict(
      () => assertPassAction('expired', 'regenerate_qr'),
      "Cannot regenerate QR for pass in status 'expired'",
    );
  });

  test('incidents can move only while open or investigating', () => {
    for (const status of ['open', 'investigating']) {
      expect(() => assertIncidentAction(status, 'assign')).not.toThrow();
      expect(() => assertIncidentAction(status, 'resolve')).not.toThrow();
      expect(() => assertIncidentAction(status, 'dismiss')).not.toThrow();
    }

    expectConflict(
      () => assertIncidentAction('resolved', 'assign'),
      "Cannot assign in status 'resolved'",
    );
    expectConflict(
      () => assertIncidentAction('dismissed', 'resolve'),
      'Incident already dismissed',
    );
    expectConflict(
      () => assertIncidentAction('resolved', 'dismiss'),
      'Incident already resolved',
    );
  });
});
