const { test, expect } = require('@playwright/test');

const ROLE_MATRIX = [
  { phone: '+7 916 123-45-67', role: 'owner', defaultTab: 'passes' },
  { phone: '+7 917 567-89-01', role: 'security', defaultTab: 'guardpost' },
  { phone: '+7 495 123-00-00', role: 'admin', defaultTab: 'stats' },
];

async function loginDemo(page, phone) {
  await page.goto('/');
  await page.waitForSelector('.login-form', { timeout: 15000 });
  await page.locator('button.demo-toggle').click();
  await page.locator('button.demo-row', { hasText: phone }).click();
  await page.locator('input.field-otp').fill('123456');
  await page.waitForURL(/\/dashboard\//, { timeout: 15000 });
}

test.describe('role navigation matrix', () => {
  for (const row of ROLE_MATRIX) {
    test(`${row.role}: lands on role default tab after login`, async ({ page }) => {
      await loginDemo(page, row.phone);
      await expect(page).toHaveURL(new RegExp(`/dashboard/${row.defaultTab}`));
    });

    test(`${row.role}: direct URL to default tab stays addressable`, async ({ page }) => {
      await loginDemo(page, row.phone);
      await page.goto(`/dashboard/${row.defaultTab}`);
      await page.waitForURL(new RegExp(`/dashboard/${row.defaultTab}`));
    });
  }

  test('network degraded while navigating keeps URL-first behavior', async ({ page }) => {
    await loginDemo(page, '+7 916 123-45-67');
    await page.route('**/api/v1/chat/messages**', (route) => route.abort('failed'));
    await page.goto('/dashboard/chat');
    await expect(page).toHaveURL(/\/dashboard\/chat/);
  });
});
