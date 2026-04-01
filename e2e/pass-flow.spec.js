const { test, expect } = require('@playwright/test');

async function loginDemo(page, role) {
  const rolePhone = {
    owner: '+7 916 123-45-67',
    security: '+7 917 567-89-01',
    admin: '+7 495 123-00-00',
  };

  await page.goto('/');
  await page.waitForSelector('.login-form', { timeout: 15000 });

  await page.locator('button.demo-toggle').click();
  await page.locator('button.demo-row', { hasText: rolePhone[role] }).click();
  await page.locator('input.field-otp').fill('1234');
  await page.getByRole('button', { name: 'Войти' }).click();
}

test.describe('Nightly smoke', () => {
  test('owner can login in demo mode', async ({ page }) => {
    await loginDemo(page, 'owner');
    await expect(page.getByText('Добро пожаловать').first()).toBeVisible({ timeout: 15000 });
  });

  test('security can login in demo mode', async ({ page }) => {
    await loginDemo(page, 'security');
    await expect(page.getByText('Пост охраны').first()).toBeVisible({ timeout: 15000 });
  });

  test('offline banner appears when network is down', async ({ page }) => {
    await loginDemo(page, 'owner');
    await page.context().setOffline(true);
    await expect(page.getByText('Нет подключения к интернету').first()).toBeVisible({ timeout: 10000 });
    await page.context().setOffline(false);
  });

  test('admin delete -> users-deleted -> restore flow', async ({ page }) => {
    await loginDemo(page, 'admin');

    await page.getByRole('button', { name: 'Пользователи' }).click();
    const deleteBtns = page.getByRole('button', { name: 'Удалить пользователя' });
    await expect(deleteBtns.first()).toBeVisible({ timeout: 10000 });
    await deleteBtns.first().click();

    await page.getByRole('button', { name: 'Удалённые' }).click();
    const restoreBtn = page.getByRole('button', { name: 'Восстановить' }).first();
    await expect(restoreBtn).toBeVisible({ timeout: 10000 });
    await restoreBtn.click();
    await expect(restoreBtn).not.toBeVisible({ timeout: 10000 });
  });
});
