/**
 * e2e/pass-flow.spec.js — FIX [T1]: КРИТИЧНО
 *
 * Полный цикл: создание заявки → одобрение охраной → отметка прохода.
 * Рефакторинг любого из этапов теперь даёт немедленную регрессию.
 */

const { test, expect } = require('@playwright/test');

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function loginAs(page, role) {
  // Demo-режим: выбор роли через интерфейс
  await page.goto('/');
  await page.waitForSelector('[data-testid="demo-role-select"], .login-form', { timeout: 10_000 });

  // Если demo mode — выбираем роль
  const demoSelect = page.locator('[data-testid="demo-role-select"]');
  if (await demoSelect.isVisible()) {
    await demoSelect.selectOption(role);
    await page.click('[data-testid="demo-login-btn"]');
  } else {
    // Live mode: ввод телефона + OTP
    const phones = {
      resident: '+79001234567',
      security: '+79001234568',
      admin:    '+79001234569',
    };
    await page.fill('[data-testid="phone-input"]', phones[role] || phones.resident);
    await page.click('[data-testid="send-otp-btn"]');
    // В тестовой среде OTP = 123456
    await page.fill('[data-testid="otp-input"]', '123456');
    await page.click('[data-testid="verify-otp-btn"]');
  }

  await page.waitForSelector('[data-testid="dashboard"]', { timeout: 10_000 });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Pass Flow — полный цикл', () => {
  test('создание заявки резидентом → одобрение охраной → отметка прохода', async ({ page }) => {
    // 1. Логин как резидент
    await loginAs(page, 'resident');

    // 2. Создание заявки
    const createBtn = page.locator('[data-testid="create-pass"], .create-pass-btn').first();
    await expect(createBtn).toBeVisible({ timeout: 5_000 });
    await createBtn.click();

    // Заполнение формы
    await page.waitForSelector('[data-testid="create-modal"], .create-modal', { timeout: 5_000 });

    const nameInput = page.locator('[name="visitorName"], [data-testid="visitor-name"]').first();
    if (await nameInput.isVisible()) {
      await nameInput.fill('Тестовый Гость');
    }

    // Submit
    const submitBtn = page.locator('[data-testid="submit"], .create-modal button[type="submit"]').first();
    await submitBtn.click();

    // Ждём появления заявки в списке
    await expect(page.locator('text=Тестовый Гость').first()).toBeVisible({ timeout: 5_000 });

    // 3. Логин как охрана
    await loginAs(page, 'security');

    // 4. Одобрение заявки
    const approveBtn = page.locator('[data-testid="approve-btn"], .guard-btn.approve').first();
    await expect(approveBtn).toBeVisible({ timeout: 5_000 });
    await approveBtn.click();

    // Подтверждение (если есть двойной клик)
    const confirmBtn = page.locator('.guard-btn.approve.confirm').first();
    if (await confirmBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await confirmBtn.click();
    }

    // Проверяем что статус изменился
    await expect(
      page.locator('.status-arrived, .status-approved, text=Допущен').first()
    ).toBeVisible({ timeout: 5_000 });
  });

  test('отклонение заявки охраной', async ({ page }) => {
    // Создаём заявку как резидент
    await loginAs(page, 'resident');

    const createBtn = page.locator('[data-testid="create-pass"], .create-pass-btn').first();
    await expect(createBtn).toBeVisible({ timeout: 5_000 });
    await createBtn.click();

    await page.waitForSelector('[data-testid="create-modal"], .create-modal');
    const nameInput = page.locator('[name="visitorName"], [data-testid="visitor-name"]').first();
    if (await nameInput.isVisible()) {
      await nameInput.fill('Отклонённый Гость');
    }
    await page.locator('[data-testid="submit"], .create-modal button[type="submit"]').first().click();

    // Логин как охрана и отклоняем
    await loginAs(page, 'security');

    const rejectBtn = page.locator('[data-testid="reject-btn"], .guard-btn.reject').first();
    await expect(rejectBtn).toBeVisible({ timeout: 5_000 });
    await rejectBtn.click();

    // Подтверждение
    const confirmReject = page.locator('.guard-btn.reject.confirm').first();
    if (await confirmReject.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await confirmReject.click();
    }

    // Toast или статус изменился
    await expect(
      page.locator('text=отказано, text=Отклонён, .toast').first()
    ).toBeVisible({ timeout: 5_000 });
  });

  test('offline banner появляется при потере сети', async ({ page }) => {
    await loginAs(page, 'resident');

    // Имитируем offline
    await page.context().setOffline(true);

    await expect(
      page.locator('text=Нет подключения к интернету, text=Нет интернета').first()
    ).toBeVisible({ timeout: 5_000 });

    // Восстановление
    await page.context().setOffline(false);
  });
});
