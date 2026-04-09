const { test, expect } = require('@playwright/test');

async function loginDemo(page, role) {
  const rolePhone = {
    owner: '+7 916 123-45-67',
    security: '+7 917 567-89-01',
  };

  await page.goto('/');
  await page.waitForSelector('.login-form', { timeout: 15000 });
  await page.locator('button.demo-toggle').click();
  await page.locator('button.demo-row', { hasText: rolePhone[role] }).click();
  await page.locator('input.field-otp').fill('123456');
  await page.waitForURL(/\/dashboard\//, { timeout: 15000 });
}

test.describe('Nightly smoke', () => {
  test('owner can login in demo mode', async ({ page }) => {
    await loginDemo(page, 'owner');
    await expect(page).toHaveURL(/\/dashboard\/passes/, { timeout: 15000 });
  });

  test('security can login in demo mode', async ({ page }) => {
    await loginDemo(page, 'security');
    await expect(page).toHaveURL(/\/dashboard\/guardpost/, { timeout: 15000 });
  });

  test('demo mode keeps dashboard usable while browser is offline', async ({ page }) => {
    await loginDemo(page, 'owner');
    await page.context().setOffline(true);
    await expect(page.locator('.content')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.offline-banner.is-visible')).toHaveCount(0);
    await page.context().setOffline(false);
  });
});
