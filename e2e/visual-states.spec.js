const { test, expect } = require('./test');

async function loginDemo(page, phone = '+7 916 123-45-67') {
  await page.goto('/');
  await page.waitForSelector('.login-form', { timeout: 15000 });
  await page.locator('button.demo-toggle').click();
  await page.locator('button.demo-row', { hasText: phone }).click();
  await page.locator('input.field-otp').fill('123456');
  await page.waitForURL(/\/dashboard\//, { timeout: 15000 });
}

test.describe('Visual smoke states', () => {
  test('login baseline is visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.login-form')).toBeVisible();
  });

  test('dashboard passes shell renders for owner', async ({ page }) => {
    await loginDemo(page);
    await page.waitForURL(/\/dashboard\/passes/);
    await expect(page.locator('.page-title')).toBeVisible();
    await expect(page.getByRole('button', { name: /Новый пропуск/i })).toBeVisible();
  });

  test('dashboard chat route is reachable for owner', async ({ page }) => {
    await loginDemo(page);
    await page.goto('/dashboard/chat');
    await page.waitForURL(/\/dashboard\/chat/);
  });
});
