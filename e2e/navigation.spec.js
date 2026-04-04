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

test.describe('URL routing and deep links (P-01/A-01)', () => {
  test('root / redirects to /dashboard', async ({ page }) => {
    await page.goto('/');
    // Before login, the page stays at / (login screen shown)
    // After login it navigates to /dashboard/<tab>
    await loginDemo(page);
    await expect(page).toHaveURL(/\/dashboard\//);
  });

  test('after login URL contains default tab for owner', async ({ page }) => {
    await loginDemo(page);
    await expect(page).toHaveURL(/\/dashboard\/passes/);
  });

  test('clicking nav tab updates URL', async ({ page }) => {
    await loginDemo(page);
    // Wait for nav to be ready
    await page.waitForSelector('.top-nav, .mobile-nav', { timeout: 10000 });
    // Click chat tab (exists for owner role)
    const chatBtn = page.locator('[class*="tn-btn"], [class*="mn-btn"]').filter({ hasText: 'Чат' }).first();
    await chatBtn.click();
    await expect(page).toHaveURL(/\/dashboard\/chat/);
  });

  test('deep link /dashboard/chat navigates directly to chat tab', async ({ page }) => {
    await loginDemo(page);
    // Navigate directly to chat URL
    await page.goto('/dashboard/chat');
    await page.waitForURL(/\/dashboard\/chat/, { timeout: 5000 });
    // The chat tab should be active (page title "Чат" visible)
    await expect(page.locator('.page-title')).toHaveText('Чат', { timeout: 5000 });
  });

  test('unknown route redirects to /', async ({ page }) => {
    await page.goto('/nonexistent-route');
    // Should redirect to / then show login
    await expect(page).toHaveURL('/', { timeout: 5000 });
    await expect(page.locator('.login-form')).toBeVisible({ timeout: 5000 });
  });

  test('browser back/forward navigates between tabs', async ({ page }) => {
    await loginDemo(page);
    await page.waitForURL(/\/dashboard\/passes/);

    // Navigate to chat
    const chatBtn = page.locator('[class*="tn-btn"]').filter({ hasText: 'Чат' }).first();
    await chatBtn.click();
    await page.waitForURL(/\/dashboard\/chat/);

    // Go back
    await page.goBack();
    await expect(page).toHaveURL(/\/dashboard\/passes/, { timeout: 5000 });
  });
});
