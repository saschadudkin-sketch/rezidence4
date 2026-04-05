const { test, expect } = require('@playwright/test');

async function loginDemo(page, phone = '+7 916 123-45-67') {
  await page.goto('/');
  await page.waitForSelector('.login-form', { timeout: 15000 });
  await page.locator('button.demo-toggle').click();
  await page.locator('button.demo-row', { hasText: phone }).click();
  await page.locator('input.field-otp').fill('1234');
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.waitForURL(/\/dashboard\//, { timeout: 15000 });
}

test.describe('Visual regression states', () => {
  test('login baseline', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.login-form');
    await expect(page).toHaveScreenshot('login-baseline.png', { fullPage: true });
  });

  test('dashboard passes baseline (owner)', async ({ page }) => {
    await loginDemo(page);
    await page.waitForURL(/\/dashboard\/passes/);
    await expect(page).toHaveScreenshot('dashboard-owner-passes.png', { fullPage: true });
  });

  test('dashboard chat baseline (owner)', async ({ page }) => {
    await loginDemo(page);
    await page.goto('/dashboard/chat');
    await page.waitForURL(/\/dashboard\/chat/);
    await expect(page).toHaveScreenshot('dashboard-owner-chat.png', { fullPage: true });
  });
});
