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

  test('admin can restore deleted user from users-deleted tab', async ({ page }) => {
    await page.route('**/api/users/deleted', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { uid: 'u-del-1', name: 'Удалённый Пользователь', phone: '+7 900 123-45-67', apartment: '15', deletedAt: '2026-03-31T10:00:00.000Z' },
        ]),
      });
    });
    await page.route('**/api/users/u-del-1/restore', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    await loginDemo(page, 'admin');
    await page.getByRole('button', { name: 'Удалённые' }).click();
    const restoreBtn = await page.getByRole('button', { name: 'Восстановить' });
    await expect(restoreBtn).toBeVisible({ timeout: 10000 });
    await restoreBtn.click();
    await expect(page.getByText('Удалённый Пользователь')).not.toBeVisible({ timeout: 10000 });
  });
});
