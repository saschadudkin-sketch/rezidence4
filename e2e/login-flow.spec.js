const { test, expect } = require('./test');

async function openOtpStepDemo(page) {
  await page.goto('/');
  await page.waitForSelector('.login-form', { timeout: 15000 });
  await page.locator('button.demo-toggle').click();
  await page.locator('button.demo-row', { hasText: '+7 916 123-45-67' }).click();
  await expect(page.locator('input.field-otp')).toBeVisible({ timeout: 10000 });
}

test.describe('Login flow smoke', () => {
  test('shows resend countdown on OTP step', async ({ page }) => {
    await openOtpStepDemo(page);
    const resendBtn = page.locator('.btn-text').first();
    await expect(resendBtn).toBeDisabled();
    await expect(resendBtn).toContainText('повторно');
  });

  test('shows inline error for too-short OTP', async ({ page }) => {
    await openOtpStepDemo(page);
    await page.locator('input.field-otp').fill('12');
    await page.locator('.btn-gold').click();
    await expect(page.locator('.field-err')).toBeVisible();
  });

  test('can return from OTP to phone step', async ({ page }) => {
    await openOtpStepDemo(page);
    await page.locator('.btn-text').nth(1).click();
    await expect(page.getByPlaceholder('+7 000 000-00-00')).toBeVisible();
  });

  test('enables resend after countdown ends', async ({ page }) => {
    await page.clock.install();
    await openOtpStepDemo(page);
    const resendBtn = page.locator('.btn-text').first();
    await expect(resendBtn).toBeDisabled();
    await page.clock.runFor('00:31');
    await expect(resendBtn).toBeEnabled();
    await expect(resendBtn).toHaveText('Отправить код повторно');
  });
});
