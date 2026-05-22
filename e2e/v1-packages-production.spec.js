const crypto = require('node:crypto');
const { test, expect } = require('./test');
const { buildE2EEnv } = require('../scripts/e2e-env.cjs');
const { stubExternalFontAssets } = require('./support/externalAssets');

const e2eEnv = buildE2EEnv(process.env);
const enabled = e2eEnv.E2E_V1_PACKAGES === '1' || e2eEnv.E2E_BACKEND_MODE === '1';
const propertySlug = e2eEnv.E2E_PROPERTY_SLUG || 'zamoskv';
const jwtSecret = e2eEnv.JWT_SECRET || 'ci-dummy-jwt-secret-32chars-padding-ok';
const csrfToken = 'p'.repeat(64);

const USERS = {
  resident: {
    uid: 'e2e-v1-resident',
    role: 'owner',
    name: 'E2E Resident',
  },
  security: {
    uid: 'e2e-v1-security',
    role: 'security',
    name: 'E2E Security',
  },
  concierge: {
    uid: 'e2e-v1-concierge',
    role: 'concierge',
    name: 'E2E Concierge',
  },
  admin: {
    uid: 'e2e-v1-admin',
    role: 'admin',
    name: 'E2E Property Admin',
  },
};

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signJwt(user) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = base64urlJson({
    uid: user.uid,
    role: user.role,
    name: user.name,
    property_slug: propertySlug,
    jti: `e2e-${user.uid}-${crypto.randomUUID()}`,
    iat: now,
    exp: now + 15 * 60,
  });
  const body = `${header}.${payload}`;
  const signature = crypto.createHmac('sha256', jwtSecret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function originFromBaseURL(baseURL) {
  return new URL(baseURL || 'http://127.0.0.1:3000').origin;
}

async function newAuthedPage(browser, baseURL, user) {
  const origin = originFromBaseURL(baseURL);
  const cookieUrl = new URL(origin);
  const context = await browser.newContext({ baseURL: origin });
  await stubExternalFontAssets(context);
  await context.addCookies([
    {
      name: 'token',
      value: signJwt(user),
      domain: cookieUrl.hostname,
      path: '/',
      httpOnly: true,
      secure: cookieUrl.protocol === 'https:',
      sameSite: 'Strict',
    },
    {
      name: 'rz-csrf',
      value: csrfToken,
      domain: cookieUrl.hostname,
      path: '/',
      httpOnly: false,
      secure: cookieUrl.protocol === 'https:',
      sameSite: 'Strict',
    },
  ]);
  return { context, page: await context.newPage() };
}

function packageRow(page, trackingNumber) {
  return page.locator(`[data-testid="package-row"][data-tracking-number="${trackingNumber}"]`);
}

function residentPackageRow(page, trackingNumber) {
  return page.locator(`[data-testid="resident-package-row"][data-tracking-number="${trackingNumber}"]`);
}

async function postPackageAction(page, packageId, action, data = {}) {
  const origin = new URL(page.url()).origin;
  return page.request.post(`/api/v1/packages/${packageId}/${action}`, {
    headers: {
      Origin: origin,
      'X-CSRF-Token': csrfToken,
    },
    data,
  });
}

function attachRuntimeGuards(page, errors) {
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('response', (response) => {
    const url = response.url();
    const status = response.status();
    if (new URL(url).pathname.startsWith('/api/') && status >= 400) {
      errors.push(`${response.request().method()} ${url} -> ${status}`);
    }
  });
  page.on('requestfailed', (request) => {
    const failure = request.failure();
    if (failure?.errorText === 'net::ERR_ABORTED') return;
    errors.push(`${request.method()} ${request.url()} failed: ${failure?.errorText || 'unknown'}`);
  });
}

async function openStaffPackagesViaRoleNavigation(page) {
  await page.goto('/v1');
  await page
    .getByRole('navigation', { name: 'Пилотная навигация операций' })
    .getByRole('link', { name: 'Посылки' })
    .click();
  await expect(page).toHaveURL(/\/v1\/packages$/);
  await expect(page.getByRole('heading', { name: 'Посылки' })).toBeVisible();
}

async function receivePackageFromOpenStaffPage(page, input) {
  await page.getByRole('button', { name: '+ Принять посылку' }).click();
  const createForm = page.getByTestId('package-create-form');
  await expect(createForm).toBeVisible();

  const unitSelect = createForm.locator('#pkg-unit');
  await expect(unitSelect.locator('option', { hasText: '101' }).first()).toHaveCount(1);
  const unitValue = await unitSelect.locator('option', { hasText: '101' }).first().getAttribute('value');
  expect(unitValue).toMatch(/^[0-9a-f-]{36}$/i);
  await unitSelect.selectOption(unitValue);
  await createForm.locator('#pkg-recipient').fill(input.recipientName || 'E2E Resident');
  await createForm.locator('#pkg-sender').fill(input.sender);
  await createForm.locator('#pkg-carrier').fill(input.carrier || 'Phase6 courier');
  await createForm.locator('#pkg-tracking').fill(input.tracking);
  await createForm.locator('#pkg-storage').fill(input.storage);
  await createForm.locator('#pkg-notes').fill(input.notes || 'Phase 6 package intake browser e2e');

  const createResponse = page.waitForResponse((response) =>
    response.url().includes('/api/v1/packages') &&
    response.request().method() === 'POST' &&
    response.status() === 201,
  );
  await createForm.getByRole('button', { name: 'Принять посылку' }).click();
  const created = await (await createResponse).json();
  expect(created.package.status).toBe('awaiting_pickup');

  const awaitingRow = packageRow(page, input.tracking);
  await expect(awaitingRow).toBeVisible();
  await expect(awaitingRow).toHaveAttribute('data-package-status', 'awaiting_pickup');
  await expect(awaitingRow).toContainText(input.storage);
  return { created, awaitingRow };
}

async function openResidentPackagesViaRoleNavigation(page) {
  await page.goto('/v1');
  await expect(page).toHaveURL(/\/v1\/access$/);
  await expect(page.getByRole('heading', { name: /Пропуска|Доступ/i })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Навигация жильца' })
    .getByRole('link', { name: 'Мои посылки' })
    .click();
  await expect(page).toHaveURL(/\/v1\/my\/packages$/);
  await expect(page.getByRole('heading', { name: 'Мои посылки' })).toBeVisible();
}

test.describe('platform-v1 packages production e2e', () => {
  test.skip(!enabled, 'backend-backed v1 packages e2e is enabled with E2E_V1_PACKAGES=1');

  test('resident cannot deep-link into staff package intake', async ({ browser, baseURL }) => {
    const resident = await newAuthedPage(browser, baseURL, USERS.resident);
    try {
      await resident.page.goto('/v1/packages');
      await expect(resident.page).not.toHaveURL(/\/v1\/packages$/);
      await expect(resident.page.getByTestId('packages-admin-page')).toHaveCount(0);
      await expect(resident.page.getByRole('button', { name: '+ Принять посылку' })).toHaveCount(0);
    } finally {
      await resident.context.close().catch(() => {});
    }
  });

  test('security receives a package through role nav, resident sees it, security picks it up, resident sees completion', async ({ browser, baseURL }) => {
    const contexts = [];
    const runtimeErrors = [];
    const stamp = Date.now();
    const tracking = `PW-PKG-${stamp}`;
    const sender = `Phase6 sender ${stamp}`;
    const carrier = `Phase6 courier`;
    const storage = `A-${String(stamp).slice(-4)}`;
    const pickupName = `E2E Resident Pickup ${stamp}`;

    try {
      const security = await newAuthedPage(browser, baseURL, USERS.security);
      const resident = await newAuthedPage(browser, baseURL, USERS.resident);
      contexts.push(security.context, resident.context);
      attachRuntimeGuards(security.page, runtimeErrors);
      attachRuntimeGuards(resident.page, runtimeErrors);

      await openStaffPackagesViaRoleNavigation(security.page);
      await expect(security.page.getByRole('link', { name: 'КПП' })).toHaveAttribute('href', '/v1/guard');

      const { created, awaitingRow } = await receivePackageFromOpenStaffPage(security.page, {
        tracking,
        sender,
        carrier,
        storage,
      });
      await expect(awaitingRow.getByRole('button', { name: 'Выдать' })).toBeVisible();
      await expect(awaitingRow.getByRole('button', { name: 'Возврат' })).toHaveCount(0);
      await expect(awaitingRow.getByRole('button', { name: 'Напомнить' })).toHaveCount(0);
      await expect(awaitingRow.getByRole('button', { name: 'Утеряна' })).toHaveCount(0);

      const forbiddenReturn = await postPackageAction(security.page, created.package.id, 'return', {
        reason: 'security should not return',
      });
      expect(forbiddenReturn.status()).toBe(403);
      const forbiddenRemind = await postPackageAction(security.page, created.package.id, 'remind');
      expect(forbiddenRemind.status()).toBe(403);
      const forbiddenLost = await postPackageAction(security.page, created.package.id, 'mark-lost', {
        confirm: true,
        reason: 'security should not mark lost',
      });
      expect(forbiddenLost.status()).toBe(403);

      await openResidentPackagesViaRoleNavigation(resident.page);
      const residentAwaitingRow = residentPackageRow(resident.page, tracking);
      await expect(residentAwaitingRow).toBeVisible();
      await expect(residentAwaitingRow).toHaveAttribute('data-package-status', 'awaiting_pickup');
      await expect(residentAwaitingRow).toContainText('Ждёт выдачи');
      await expect(residentAwaitingRow).toContainText(storage);

      await awaitingRow.getByRole('button', { name: 'Выдать' }).click();
      const pickupForm = awaitingRow.getByTestId('package-pickup-form');
      await expect(pickupForm).toBeVisible();
      await pickupForm.locator('#pickup-name').fill(pickupName);
      const pickupResponse = security.page.waitForResponse((response) =>
        response.url().includes(`/api/v1/packages/${created.package.id}/pickup`) &&
        response.request().method() === 'POST' &&
        response.status() === 200,
      );
      await pickupForm.getByRole('button', { name: 'Выдать' }).click();
      const pickedUp = await (await pickupResponse).json();
      expect(pickedUp.package.status).toBe('picked_up');
      expect(pickedUp.package.picked_up_by_name).toBe(pickupName);

      await security.page.locator('#pkg-status').selectOption('picked_up');
      const pickedUpRow = packageRow(security.page, tracking);
      await expect(pickedUpRow).toBeVisible();
      await expect(pickedUpRow).toHaveAttribute('data-package-status', 'picked_up');

      await resident.page.reload();
      const residentPickedUpRow = residentPackageRow(resident.page, tracking);
      await expect(residentPickedUpRow).toBeVisible();
      await expect(residentPickedUpRow).toHaveAttribute('data-package-status', 'picked_up');
      await expect(residentPickedUpRow).toContainText('Получено');
      await expect(residentPickedUpRow).toContainText(pickupName);

      expect(runtimeErrors).toEqual([]);
    } finally {
      await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    }
  });

  test('package edge errors stay understandable in the UI', async ({ browser, baseURL }) => {
    const contexts = [];
    const stamp = Date.now();
    const tracking = `PW-PKG-EDGE-${stamp}`;
    const sender = `Edge sender ${stamp}`;
    const storage = `E-${String(stamp).slice(-4)}`;

    try {
      const concierge = await newAuthedPage(browser, baseURL, USERS.concierge);
      contexts.push(concierge.context);

      await openStaffPackagesViaRoleNavigation(concierge.page);
      const { created, awaitingRow } = await receivePackageFromOpenStaffPage(concierge.page, {
        tracking,
        sender,
        carrier: 'Edge courier',
        storage,
        notes: 'Negative package browser e2e',
      });

      const firstRemindResponse = concierge.page.waitForResponse((response) =>
        response.url().includes(`/api/v1/packages/${created.package.id}/remind`) &&
        response.request().method() === 'POST' &&
        response.status() === 200,
      );
      await awaitingRow.getByRole('button', { name: 'Напомнить' }).click();
      await firstRemindResponse;
      await expect(awaitingRow.getByText(/Напоминание отправлено/)).toBeVisible();

      const rateLimitResponse = concierge.page.waitForResponse((response) =>
        response.url().includes(`/api/v1/packages/${created.package.id}/remind`) &&
        response.request().method() === 'POST' &&
        response.status() === 429,
      );
      await awaitingRow.getByRole('button', { name: 'Напомнить' }).click();
      const rateLimited = await (await rateLimitResponse).json();
      expect(rateLimited.error.message).toBe('Напоминание уже отправлено. Подождите час.');
      await expect(awaitingRow.getByText('Напоминание уже отправлено. Подождите час.')).toBeVisible();
      await expect(awaitingRow.getByText('HTTP 429')).toHaveCount(0);

      const stalePickup = await postPackageAction(concierge.page, created.package.id, 'pickup', {
        picked_up_by_name: `Stale pickup ${stamp}`,
      });
      expect(stalePickup.status()).toBe(200);

      await awaitingRow.getByRole('button', { name: 'Возврат' }).click();
      const returnReason = awaitingRow.locator('#return-reason');
      await expect(returnReason).toBeVisible();
      await returnReason.fill(`Late return ${stamp}`);
      const conflictResponse = concierge.page.waitForResponse((response) =>
        response.url().includes(`/api/v1/packages/${created.package.id}/return`) &&
        response.request().method() === 'POST' &&
        response.status() === 409,
      );
      await awaitingRow.getByRole('button', { name: 'Оформить возврат' }).click();
      const conflict = await (await conflictResponse).json();
      expect(conflict.error).toContain('Cannot return from status');
      await expect(
        awaitingRow.getByText('Посылка уже обработана. Обновите список и проверьте текущий статус.'),
      ).toBeVisible();
      await expect(awaitingRow.getByText(/Cannot return from status/)).toHaveCount(0);
    } finally {
      await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    }
  });

  test('concierge can remind and return a package but cannot mark it lost', async ({ browser, baseURL }) => {
    const contexts = [];
    const runtimeErrors = [];
    const stamp = Date.now();
    const tracking = `PW-PKG-CON-${stamp}`;
    const sender = `Concierge sender ${stamp}`;
    const storage = `C-${String(stamp).slice(-4)}`;
    const reason = `E2E concierge return ${stamp}`;

    try {
      const concierge = await newAuthedPage(browser, baseURL, USERS.concierge);
      contexts.push(concierge.context);
      attachRuntimeGuards(concierge.page, runtimeErrors);

      await openStaffPackagesViaRoleNavigation(concierge.page);
      await expect(concierge.page).toHaveURL(/\/v1\/packages$/);

      const { created, awaitingRow } = await receivePackageFromOpenStaffPage(concierge.page, {
        tracking,
        sender,
        carrier: 'Concierge courier',
        storage,
        notes: 'Concierge return/remind browser e2e',
      });
      await expect(awaitingRow.getByRole('button', { name: 'Выдать' })).toBeVisible();
      await expect(awaitingRow.getByRole('button', { name: 'Возврат' })).toBeVisible();
      await expect(awaitingRow.getByRole('button', { name: 'Напомнить' })).toBeVisible();
      await expect(awaitingRow.getByRole('button', { name: 'Утеряна' })).toHaveCount(0);

      const remindResponse = concierge.page.waitForResponse((response) =>
        response.url().includes(`/api/v1/packages/${created.package.id}/remind`) &&
        response.request().method() === 'POST' &&
        response.status() === 200,
      );
      await awaitingRow.getByRole('button', { name: 'Напомнить' }).click();
      const reminded = await (await remindResponse).json();
      expect(reminded.package.status).toBe('awaiting_pickup');
      await expect(awaitingRow.getByText(/Напоминание отправлено/)).toBeVisible();

      await awaitingRow.getByRole('button', { name: 'Возврат' }).click();
      const returnReason = awaitingRow.locator('#return-reason');
      await expect(returnReason).toBeVisible();
      await returnReason.fill(reason);
      const returnResponse = concierge.page.waitForResponse((response) =>
        response.url().includes(`/api/v1/packages/${created.package.id}/return`) &&
        response.request().method() === 'POST' &&
        response.status() === 200,
      );
      await awaitingRow.getByRole('button', { name: 'Оформить возврат' }).click();
      const returned = await (await returnResponse).json();
      expect(returned.package.status).toBe('returned');
      expect(returned.package.returned_reason).toBe(reason);

      await concierge.page.locator('#pkg-status').selectOption('returned');
      const returnedRow = packageRow(concierge.page, tracking);
      await expect(returnedRow).toBeVisible();
      await expect(returnedRow).toHaveAttribute('data-package-status', 'returned');
      await expect(returnedRow).toContainText('возвращена');

      expect(runtimeErrors).toEqual([]);
    } finally {
      await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    }
  });

  test('admin can use full package operations including mark-lost', async ({ browser, baseURL }) => {
    const contexts = [];
    const runtimeErrors = [];
    const stamp = Date.now();
    const tracking = `PW-PKG-ADM-${stamp}`;
    const sender = `Admin sender ${stamp}`;
    const storage = `L-${String(stamp).slice(-4)}`;
    const reason = `E2E admin lost ${stamp}`;

    try {
      const admin = await newAuthedPage(browser, baseURL, USERS.admin);
      contexts.push(admin.context);
      attachRuntimeGuards(admin.page, runtimeErrors);

      await openStaffPackagesViaRoleNavigation(admin.page);
      await expect(admin.page).toHaveURL(/\/v1\/packages$/);

      const { created, awaitingRow } = await receivePackageFromOpenStaffPage(admin.page, {
        tracking,
        sender,
        carrier: 'Admin courier',
        storage,
        notes: 'Admin mark-lost browser e2e',
      });
      await expect(awaitingRow.getByRole('button', { name: 'Выдать' })).toBeVisible();
      await expect(awaitingRow.getByRole('button', { name: 'Возврат' })).toBeVisible();
      await expect(awaitingRow.getByRole('button', { name: 'Напомнить' })).toBeVisible();
      await expect(awaitingRow.getByRole('button', { name: 'Утеряна' })).toBeVisible();

      await awaitingRow.getByRole('button', { name: 'Утеряна' }).click();
      const lostReason = awaitingRow.locator('#lost-reason');
      await expect(lostReason).toBeVisible();
      await lostReason.fill(reason);
      const markLostResponse = admin.page.waitForResponse((response) =>
        response.url().includes(`/api/v1/packages/${created.package.id}/mark-lost`) &&
        response.request().method() === 'POST' &&
        response.status() === 200,
      );
      let dialogMessage = '';
      admin.page.once('dialog', async (dialog) => {
        dialogMessage = dialog.message();
        await dialog.accept();
      });
      await awaitingRow.getByRole('button', { name: 'Подтвердить утерю' }).click();
      const lost = await (await markLostResponse).json();
      expect(dialogMessage).toContain('утерянную');
      expect(lost.package.status).toBe('lost');
      expect(lost.package.returned_reason).toBe(reason);

      await admin.page.locator('#pkg-status').selectOption('lost');
      const lostRow = packageRow(admin.page, tracking);
      await expect(lostRow).toBeVisible();
      await expect(lostRow).toHaveAttribute('data-package-status', 'lost');
      await expect(lostRow).toContainText('утеряна');

      expect(runtimeErrors).toEqual([]);
    } finally {
      await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    }
  });
});
