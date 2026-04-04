const { test, expect } = require('@playwright/test');

async function loginAs(page, phone) {
  await page.goto('/');
  await page.waitForSelector('.login-form', { timeout: 15000 });
  await page.locator('button.demo-toggle').click();
  await page.locator('button.demo-row', { hasText: phone }).click();
  await page.locator('input.field-otp').fill('1234');
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.waitForURL(/\/dashboard\//, { timeout: 15000 });
}

test.describe('Pass creation flow (T-04)', () => {
  test('owner can navigate to Passes tab', async ({ page }) => {
    await loginAs(page, '+7 916 123-45-67');
    await expect(page).toHaveURL(/\/dashboard\/passes/);
    await expect(page.locator('.page-title')).toHaveText('Пропуска', { timeout: 5000 });
  });

  test('owner can open create-pass modal', async ({ page }) => {
    await loginAs(page, '+7 916 123-45-67');
    await page.waitForURL(/\/dashboard\/passes/);
    // Click the create/add pass button
    const createBtn = page.locator('button').filter({ hasText: /Создать|Добавить|Новая заявка|\+/i }).first();
    await createBtn.click();
    // Modal should open
    await expect(page.locator('[class*="modal"], [role="dialog"]').first()).toBeVisible({ timeout: 5000 });
  });

  test('security guard sees guardpost tab after login', async ({ page }) => {
    await loginAs(page, '+7 917 567-89-01');
    await expect(page).toHaveURL(/\/dashboard\/guardpost/);
    await expect(page.locator('.page-title')).toContainText('Пост', { timeout: 5000 });
  });

  test('security guard has QR scan button on guardpost', async ({ page }) => {
    await loginAs(page, '+7 917 567-89-01');
    await page.waitForURL(/\/dashboard\/guardpost/);
    await expect(page.locator('button').filter({ hasText: /Сканировать|QR/i }).first()).toBeVisible({ timeout: 5000 });
  });

  test('concierge sees passes after login', async ({ page }) => {
    await loginAs(page, '+7 925 456-78-90');
    await page.waitForURL(/\/dashboard\/passes/);
    await expect(page.locator('.page-title')).toHaveText('Заявки', { timeout: 5000 });
  });

  test('admin lands on stats tab', async ({ page }) => {
    await loginAs(page, '+7 495 123-00-00');
    await page.waitForURL(/\/dashboard\/stats/);
    await expect(page.locator('.page-title')).toHaveText('Аналитика', { timeout: 5000 });
  });
});
