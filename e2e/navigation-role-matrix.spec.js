const { test, expect } = require('@playwright/test');

const ROLE_MATRIX = [
  { phone: '+7 916 123-45-67', role: 'owner', defaultTab: 'passes', forbiddenTab: 'users' },
  { phone: '+7 917 567-89-01', role: 'security', defaultTab: 'guardpost', forbiddenTab: 'residents' },
  { phone: '+7 495 123-00-00', role: 'admin', defaultTab: 'users', forbiddenTab: 'chat' },
];

async function loginDemo(page, phone) {
  await page.goto('/');
  await page.locator('button.demo-toggle').click();
  await page.locator('button.demo-row', { hasText: phone }).click();
  await page.locator('input.field-otp').fill('1234');
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.waitForURL(/\/dashboard\//, { timeout: 15000 });
}

test.describe('role navigation matrix', () => {
  for (const row of ROLE_MATRIX) {
    test(`${row.role}: forbidden deep link redirects to default`, async ({ page }) => {
      await loginDemo(page, row.phone);
      await page.goto(`/dashboard/${row.forbiddenTab}`);
      await expect(page).toHaveURL(new RegExp(`/dashboard/${row.defaultTab}`));
    });

    test(`${row.role}: deep-link with reqId query consumes query and stays navigable`, async ({ page }) => {
      await loginDemo(page, row.phone);
      await page.goto(`/dashboard/${row.defaultTab}?reqId=REQ-TEST-1`);
      await page.waitForURL(new RegExp(`/dashboard/${row.defaultTab}`));
      await expect(page).not.toHaveURL(/reqId=/);
    });
  }

  test('network degraded while navigating keeps URL-first behavior', async ({ page }) => {
    await loginDemo(page, '+7 916 123-45-67');
    await page.route('**/api/v1/chat/messages**', (route) => route.abort('failed'));
    await page.goto('/dashboard/chat');
    await expect(page).toHaveURL(/\/dashboard\/chat/);
  });
});
