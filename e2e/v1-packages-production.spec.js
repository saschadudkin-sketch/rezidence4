const crypto = require('node:crypto');
const { test, expect } = require('./test');
const { buildE2EEnv } = require('../scripts/e2e-env.cjs');

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

test.describe('platform-v1 packages production e2e', () => {
  test.skip(!enabled, 'backend-backed v1 packages e2e is enabled with E2E_V1_PACKAGES=1');

  test('security receives a package, resident sees it, security picks it up, resident sees completion', async ({ browser, baseURL }) => {
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

      await security.page.goto('/v1/packages');
      await expect(security.page.getByRole('heading', { name: 'Посылки' })).toBeVisible();
      await expect(security.page.getByRole('link', { name: 'КПП' })).toHaveAttribute('href', '/v1/guard');

      await security.page.getByRole('button', { name: '+ Принять посылку' }).click();
      const createForm = security.page.getByTestId('package-create-form');
      await expect(createForm).toBeVisible();

      const unitSelect = createForm.locator('#pkg-unit');
      await expect(unitSelect.locator('option', { hasText: '101' }).first()).toHaveCount(1);
      const unitValue = await unitSelect.locator('option', { hasText: '101' }).first().getAttribute('value');
      expect(unitValue).toMatch(/^[0-9a-f-]{36}$/i);
      await unitSelect.selectOption(unitValue);
      await createForm.locator('#pkg-recipient').fill('E2E Resident');
      await createForm.locator('#pkg-sender').fill(sender);
      await createForm.locator('#pkg-carrier').fill(carrier);
      await createForm.locator('#pkg-tracking').fill(tracking);
      await createForm.locator('#pkg-storage').fill(storage);
      await createForm.locator('#pkg-notes').fill('Phase 6 package intake browser e2e');

      const createResponse = security.page.waitForResponse((response) =>
        response.url().includes('/api/v1/packages') &&
        response.request().method() === 'POST' &&
        response.status() === 201,
      );
      await createForm.getByRole('button', { name: 'Принять посылку' }).click();
      const created = await (await createResponse).json();
      expect(created.package.status).toBe('awaiting_pickup');

      const awaitingRow = packageRow(security.page, tracking);
      await expect(awaitingRow).toBeVisible();
      await expect(awaitingRow).toHaveAttribute('data-package-status', 'awaiting_pickup');
      await expect(awaitingRow).toContainText(storage);

      await resident.page.goto('/v1/my/packages');
      await expect(resident.page.getByRole('heading', { name: 'Мои посылки' })).toBeVisible();
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
});
