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
  const directBtn = page.locator('.mobile-nav .mn-btn', { hasText: /чат/i });
  if (await directBtn.first().isVisible().catch(() => false)) {
    await directBtn.first().click();
    return;
  }

  const moreBtn = page.locator('.mobile-nav .mn-more-btn');
  if (await moreBtn.isVisible().catch(() => false)) {
    await moreBtn.click();
    await page.locator('.mn-quick-item', { hasText: /чат/i }).click();
    return;
  }

  await page.goto('/dashboard/chat', { waitUntil: 'domcontentloaded' });
}

test.describe('Mobile routing smoke', () => {
  test('login redirects owner to default mobile tab', async ({ page }) => {
    await loginDemo(page);
    await expect(page).toHaveURL(/\/dashboard\/passes/);
  });

  test('mobile nav opens chat route', async ({ page }) => {
    await loginDemo(page);
    await openChatTab(page);
    await expect(page).toHaveURL(/\/dashboard\/chat/);
  });

  test('unknown route redirects to dashboard login shell', async ({ page }) => {
    await page.goto('/nonexistent-route');
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 5000 });
    await expect(page.locator('.login-form')).toBeVisible({ timeout: 5000 });
  });

  test('browser back returns to passes after mobile nav', async ({ page }) => {
    await loginDemo(page);
    await openChatTab(page);
    await page.waitForURL(/\/dashboard\/chat/);
    await page.goBack();
    await expect(page).toHaveURL(/\/dashboard\/passes/, { timeout: 5000 });
  });
});
