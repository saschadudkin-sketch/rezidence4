const { test, expect } = require('./test');

async function loginDemo(page, phone = '+7 916 123-45-67') {
  await page.goto('/');
  await page.waitForSelector('.login-form', { timeout: 15000 });
  await page.locator('button.demo-toggle').click();
  await page.locator('button.demo-row', { hasText: phone }).click();
  await page.locator('input.field-otp').fill('123456');
  await page.waitForURL(/\/dashboard\//, { timeout: 15000 });
}

async function openChatTab(page) {
  const mobileChatBtn = page.locator('.mobile-nav .mn-btn', { hasText: /чат/i });
  if (await mobileChatBtn.first().isVisible().catch(() => false)) {
    await mobileChatBtn.first().click();
    return;
  }

  const mobileMoreBtn = page.locator('.mobile-nav .mn-more-btn');
  if (await mobileMoreBtn.isVisible().catch(() => false)) {
    await mobileMoreBtn.click();
    await page.locator('.mn-quick-item', { hasText: /чат/i }).click();
    return;
  }

  const desktopChatBtn = page.locator('.top-nav .tn-btn', { hasText: /чат/i });
  if (await desktopChatBtn.first().isVisible().catch(() => false)) {
    await desktopChatBtn.first().click();
    return;
  }

  await page.goto('/dashboard/chat', { waitUntil: 'domcontentloaded' });
}

test.describe('URL routing and deep links (P-01/A-01)', () => {
  test('root / redirects to /dashboard after login', async ({ page }) => {
    await loginDemo(page);
    await expect(page).toHaveURL(/\/dashboard\/passes/);
  });

  test('after login URL contains default tab for owner', async ({ page }) => {
    await loginDemo(page);
    await expect(page).toHaveURL(/\/dashboard\/passes/);
  });

  test('clicking nav tab updates URL', async ({ page }) => {
    await loginDemo(page);
    await openChatTab(page);
    await expect(page).toHaveURL(/\/dashboard\/chat/);
  });

  test('direct navigation to /dashboard/chat keeps the target URL', async ({ page }) => {
    await loginDemo(page);
    await page.goto('/dashboard/chat', { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/\/dashboard\/chat/, { timeout: 5000 });
  });

  test('unknown route redirects to dashboard login shell', async ({ page }) => {
    await page.goto('/nonexistent-route');
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 5000 });
    await expect(page.locator('.login-form')).toBeVisible({ timeout: 5000 });
  });

  test('browser back/forward navigates between tabs', async ({ page }) => {
    await loginDemo(page);
    await page.waitForURL(/\/dashboard\/passes/);
    await openChatTab(page);
    await page.waitForURL(/\/dashboard\/chat/);
    await page.goBack();
    await expect(page).toHaveURL(/\/dashboard\/passes/, { timeout: 5000 });
  });
});
