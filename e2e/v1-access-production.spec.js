const crypto = require('node:crypto');
const { test, expect } = require('./test');
const { buildE2EEnv } = require('../scripts/e2e-env.cjs');

const e2eEnv = buildE2EEnv(process.env);
const enabled = e2eEnv.E2E_V1_ACCESS === '1' || e2eEnv.E2E_BACKEND_MODE === '1';
const propertySlug = e2eEnv.E2E_PROPERTY_SLUG || 'zamoskv';
const jwtSecret = e2eEnv.JWT_SECRET || 'ci-dummy-jwt-secret-32chars-padding-ok';

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

function toLocalInput(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

async function newAuthedPage(browser, baseURL, user) {
  const origin = new URL(baseURL || 'http://127.0.0.1:3000').origin;
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
      value: 'a'.repeat(64),
      domain: cookieUrl.hostname,
      path: '/',
      httpOnly: false,
      secure: cookieUrl.protocol === 'https:',
      sameSite: 'Strict',
    },
  ]);
  return { context, page: await context.newPage() };
}

test.describe('platform-v1 access production e2e', () => {
  test.skip(!enabled, 'backend-backed v1 access e2e is enabled with E2E_V1_ACCESS=1');

  test('resident creates pass, opens QR, security verifies it', async ({ browser, baseURL }) => {
    const visitorName = `Phase 1.5 guest ${Date.now()}`;
    const contexts = [];

    try {
      const resident = await newAuthedPage(browser, baseURL, USERS.resident);
      contexts.push(resident.context);

      await resident.page.goto('/v1/access');
      await expect(resident.page.getByRole('heading', { name: 'Мои заявки на доступ' })).toBeVisible();
      await resident.page.getByRole('button', { name: 'Создать заявку' }).click();
      await resident.page.getByLabel('Имя посетителя').fill(visitorName);
      await resident.page.getByLabel('Телефон (необязательно)').fill('+79005550999');
      await resident.page.getByLabel('Комментарий (необязательно)').fill('Phase 1.5 production e2e');
      await resident.page.getByLabel('Начало').fill(toLocalInput(new Date(Date.now() - 5 * 60_000)));
      await resident.page.getByLabel('Окончание').fill(toLocalInput(new Date(Date.now() + 4 * 60 * 60_000)));

      const createResponse = resident.page.waitForResponse((response) =>
        response.url().includes('/api/v1/access-requests') &&
        response.request().method() === 'POST' &&
        response.status() === 201,
      );
      await resident.page.getByRole('button', { name: 'Создать заявку' }).click();
      const created = await (await createResponse).json();
      expect(created.access_request.status).toBe('approved');
      expect(created.access_request.approval_required).toBe(false);
      expect(created.pass.status).toBe('active');

      await expect(resident.page.getByText(visitorName)).toBeVisible();
      await resident.page.getByRole('button', { name: 'Открыть QR' }).click();
      await expect(resident.page.getByAltText('QR пропуска')).toBeVisible();
      const token = (await resident.page.getByTestId('v1-qr-token').textContent()).trim();
      expect(token).toMatch(/^[a-f0-9]{32}$/);

      const security = await newAuthedPage(browser, baseURL, USERS.security);
      contexts.push(security.context);
      await security.page.goto('/v1/guard');
      await expect(security.page.getByRole('heading', { name: 'Пост охраны' })).toBeVisible();
      await security.page.getByRole('textbox', { name: 'QR-токен' }).fill(token);

      const verifyResponse = security.page.waitForResponse((response) =>
        response.url().includes('/api/v1/visits/verify') &&
        response.request().method() === 'POST' &&
        response.status() === 200,
      );
      await security.page.getByRole('button', { name: 'Проверить' }).click();
      await verifyResponse;
      await expect(security.page.getByText('Проход разрешён')).toBeVisible();
    } finally {
      await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    }
  });
});
