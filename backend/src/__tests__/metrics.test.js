'use strict';

describe('metrics module', () => {
  test('increments known counters and returns snapshot', () => {
    jest.resetModules();
    const metrics = require('../metrics');

    metrics.incrementCounter('authRefreshRequests');
    metrics.incrementCounter('authRefreshSuccess', 2);
    metrics.incrementCounter('unknownCounter'); // no throw

    const snap = metrics.getSnapshot();
    expect(snap.authRefreshRequests).toBeGreaterThanOrEqual(1);
    expect(snap.authRefreshSuccess).toBeGreaterThanOrEqual(2);
    expect(snap.authRefreshFailed).toBeGreaterThanOrEqual(0);
  });
});
