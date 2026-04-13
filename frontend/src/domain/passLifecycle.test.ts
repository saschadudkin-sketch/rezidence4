import { describe, expect, test } from 'vitest';
import { getRequestInitialStatus, isSecurityActionablePass } from './passLifecycle';

describe('passLifecycle', () => {
  test('unscheduled passes are approved immediately for security flow', () => {
    expect(getRequestInitialStatus({
      type: 'pass',
      userRole: 'contractor',
      passDuration: 'temporary',
      isScheduled: false,
    })).toBe('approved');
  });

  test('scheduled passes stay scheduled until activation', () => {
    expect(getRequestInitialStatus({
      type: 'pass',
      userRole: 'owner',
      passDuration: 'once',
      isScheduled: true,
    })).toBe('scheduled');
  });

  test('tech requests still start pending', () => {
    expect(getRequestInitialStatus({
      type: 'tech',
      userRole: 'owner',
      passDuration: null,
      isScheduled: false,
    })).toBe('pending');
  });

  test('security can act on pending legacy passes and approved passes', () => {
    expect(isSecurityActionablePass({
      type: 'pass',
      status: 'pending',
      passDuration: 'once',
      createdByRole: 'contractor',
    })).toBe(true);
    expect(isSecurityActionablePass({
      type: 'pass',
      status: 'approved',
      passDuration: 'temporary',
      createdByRole: 'contractor',
    })).toBe(true);
  });
});
