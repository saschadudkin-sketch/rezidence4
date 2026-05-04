// @ts-check
const { defineConfig, devices } = require('@playwright/test');
const mobileOnlySpecs = [
  /.*navigation-mobile\.spec\.js/,
  /.*mobile-interaction-contract\.spec\.js/,
];
const defaultBaseURL = 'http://127.0.0.1:3000';
const baseURL = process.env.PLAYWRIGHT_BASE_URL || defaultBaseURL;
const webServerURL = process.env.PLAYWRIGHT_WEBSERVER_URL || defaultBaseURL;

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 7_500 },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 1,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL,
    channel: 'chromium',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
    launchOptions: {
      args: ['--disable-gpu'],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: [/.*visual-states\.spec\.js/, ...mobileOnlySpecs],
    },
    {
      name: 'visual',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /.*visual-states\.spec\.js/,
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 5'] },
      testMatch: [
        /.*navigation-mobile\.spec\.js/,
        /.*mobile-interaction-contract\.spec\.js/,
      ],
    },
  ],
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER ? undefined : {
    command: 'node scripts/run-playwright-webserver.cjs',
    url: webServerURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
