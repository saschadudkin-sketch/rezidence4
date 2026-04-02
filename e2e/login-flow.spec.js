const { test, expect } = require('@playwright/test');

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
    await expect(page.getByRole('button', { name: /Отправить код повторно через/i })).toBeDisabled();
  });

  test('shows inline error for too-short OTP', async ({ page }) => {
    await openOtpStepDemo(page);
    await page.locator('input.field-otp').fill('12');
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page.getByText('Код должен содержать минимум 4 цифры')).toBeVisible();
  });

  test('can return from OTP to phone step', async ({ page }) => {
    await openOtpStepDemo(page);
    await page.getByRole('button', { name: '← Изменить номер' }).click();
    await expect(page.getByPlaceholder('+7 000 000-00-00')).toBeVisible();
  });

  test('enables resend after countdown ends', async ({ page }) => {
    await page.addInitScript(() => {
      window.__RZ_E2E_LOGIN_RESEND_SECONDS__ = 1;
    });
    await openOtpStepDemo(page);
    const resendBtn = page.getByRole('button', { name: /Отправить код повторно/i });
    await expect(resendBtn).toBeDisabled();
    await expect(resendBtn).toBeEnabled({ timeout: 4000 });
    await expect(resendBtn).toHaveText('Отправить код повторно');
  });
});
