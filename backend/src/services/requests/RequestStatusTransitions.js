'use strict';

const STATUS_TRANSITIONS = {
  owner:      { from: new Set(['pending', 'scheduled']), to: new Set(['cancelled']) },
  tenant:     { from: new Set(['pending', 'scheduled']), to: new Set(['cancelled']) },
  contractor: { from: new Set(['pending', 'scheduled']), to: new Set(['cancelled']) },
  concierge:  {
    from: new Set(['pending', 'scheduled', 'approved']),
    to:   new Set(['approved', 'rejected', 'completed', 'cancelled']),
  },
  security:   {
    from: new Set(['pending', 'approved', 'accepted']),
    to:   new Set(['approved', 'rejected', 'arrived', 'accepted', 'completed']),
  },
  admin: null,
};

function serializeStatusTransitions() {
  return Object.fromEntries(
    Object.entries(STATUS_TRANSITIONS).map(([role, rules]) => [
      role,
      rules
        ? {
            from: [...rules.from],
            to: [...rules.to],
          }
        : null,
    ]),
  );
}

function canTransition(role, currentStatus, nextStatus) {
  const rules = STATUS_TRANSITIONS[role];
  if (!rules) return true;
  return rules.from.has(currentStatus) && rules.to.has(nextStatus);
}

module.exports = {
  STATUS_TRANSITIONS,
  serializeStatusTransitions,
  canTransition,
};
