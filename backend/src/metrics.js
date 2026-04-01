'use strict';

const counters = {
  authRefreshRequests: 0,
  authRefreshSuccess: 0,
  authRefreshFailed: 0,
  authRefreshLegacyFallbackUsed: 0,
};

function incrementCounter(name, by = 1) {
  if (!Object.prototype.hasOwnProperty.call(counters, name)) return;
  counters[name] += by;
}

function getSnapshot() {
  return { ...counters };
}

module.exports = { incrementCounter, getSnapshot };
