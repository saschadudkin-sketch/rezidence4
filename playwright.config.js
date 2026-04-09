// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 7_500 },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 1,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: [/.*visual-states\.spec\.js/],
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 5'] },
      testMatch: [
        /.*login-flow\.spec\.js/,
        /.*navigation-mobile\.spec\.js/,
        /.*mobile-interaction-contract\.spec\.js/,
      ],
    },
  ],
  webServer: {
    command: 'node scripts/run-playwright-webserver.cjs',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
