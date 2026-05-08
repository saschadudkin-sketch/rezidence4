const base = require('@playwright/test');

const test = base.test.extend({
  page: async ({ page }, use) => {
    await use(page);
  },
});
const expect = base.expect;

module.exports = { test, expect, devices: base.devices };
