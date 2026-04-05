import { emitRealtimeState } from '../../utils/events';

export const REALTIME_STATES = {
  IDLE: 'idle',
  CONNECTING: 'connecting',
  LIVE: 'live',
  DEGRADED: 'degraded',
  FAILED: 'failed',
} as const;

type RealtimeState = typeof REALTIME_STATES[keyof typeof REALTIME_STATES];

export function createRealtimeStateMachine(initialState: RealtimeState = REALTIME_STATES.IDLE) {
  let state: RealtimeState = initialState;
  let enteredAt = Date.now();

  function transition(next: RealtimeState) {
    if (next === state) return;
    const now = Date.now();
    emitRealtimeState({ from: state, to: next, at: now, durationMs: now - enteredAt });
    state = next;
    enteredAt = now;
  }

  function getState() {
    return state;
  }

  return { transition, getState };
}
