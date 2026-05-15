const crypto = require('node:crypto');
const { test, expect } = require('./test');
const { buildE2EEnv } = require('../scripts/e2e-env.cjs');

const e2eEnv = buildE2EEnv(process.env);
const enabled = e2eEnv.E2E_V1_ACCESS === '1' || e2eEnv.E2E_BACKEND_MODE === '1';
const propertySlug = e2eEnv.E2E_PROPERTY_SLUG || 'zamoskv';
const jwtSecret = e2eEnv.JWT_SECRET || 'ci-dummy-jwt-secret-32chars-padding-ok';
const csrfToken = 'a'.repeat(64);

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
  admin: {
    uid: 'e2e-v1-admin',
    role: 'admin',
    name: 'E2E Property Admin',
  },
};

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signJwt(user, overrides = {}) {
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
    ...overrides,
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

function originFromBaseURL(baseURL) {
  return new URL(baseURL || 'http://127.0.0.1:3000').origin;
}

function uniquePlate(seed) {
  const letters = ['A', 'B', 'E', 'K', 'M', 'H', 'O', 'P', 'C', 'T', 'Y', 'X'];
  const digits = String(seed % 1000).padStart(3, '0');
  return [
    letters[seed % letters.length],
    digits,
    letters[Math.floor(seed / letters.length) % letters.length],
    letters[Math.floor(seed / (letters.length * letters.length)) % letters.length],
    '777',
  ].join('');
}

async function postJson(page, baseURL, path, data) {
  return page.request.post(path, {
    data,
    headers: {
      Origin: originFromBaseURL(baseURL),
      'X-CSRF-Token': csrfToken,
    },
  });
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

      const requestCard = resident.page.locator('section').filter({ hasText: visitorName }).first();
      await expect(requestCard).toBeVisible();
      await requestCard.getByRole('button', { name: 'Открыть QR' }).click();
      await expect(requestCard.getByAltText('QR пропуска')).toBeVisible();
      const token = (await requestCard.getByTestId('v1-qr-token').textContent()).trim();
      expect(token).toMatch(/^[a-f0-9]{32}$/);

      const residentPlate = uniquePlate(Date.now() + 17);
      await resident.page.getByRole('button', { name: 'Добавить авто' }).click();
      await expect(resident.page.getByLabel('Госномер')).toBeVisible();
      await resident.page.getByLabel('Госномер').fill(residentPlate);
      await resident.page.getByLabel('Марка').fill('Lada');
      await resident.page.getByLabel('Модель').fill('Vesta');
      const vehicleResponse = resident.page.waitForResponse((response) =>
        response.url().includes('/api/v1/vehicles') &&
        response.request().method() === 'POST' &&
        response.status() === 201,
      );
      await resident.page.getByRole('button', { name: 'Сохранить авто' }).click();
      const vehicleBody = await (await vehicleResponse).json();
      expect(vehicleBody.vehicle.plate_number).toBe(residentPlate);
      await expect(resident.page.getByText(residentPlate)).toBeVisible();

      await resident.page.getByRole('button', { name: 'Создать заявку' }).click();
      await resident.page.getByLabel('Тип заявки').selectOption('vehicle_access');
      await resident.page.getByLabel('Авто').selectOption(vehicleBody.vehicle.id);
      await resident.page.getByLabel('Комментарий (необязательно)').fill('Resident vehicle access e2e');
      await resident.page.getByLabel('Начало').fill(toLocalInput(new Date(Date.now() - 5 * 60_000)));
      await resident.page.getByLabel('Окончание').fill(toLocalInput(new Date(Date.now() + 4 * 60 * 60_000)));
      const vehicleAccessResponse = resident.page.waitForResponse((response) =>
        response.url().includes('/api/v1/access-requests') &&
        response.request().method() === 'POST' &&
        response.status() === 201,
      );
      await resident.page.getByRole('button', { name: 'Создать заявку' }).click();
      const vehicleAccessBody = await (await vehicleAccessResponse).json();
      expect(vehicleAccessBody.access_request.request_type).toBe('vehicle_access');
      expect(vehicleAccessBody.access_request.vehicle_id).toBe(vehicleBody.vehicle.id);

      const security = await newAuthedPage(browser, baseURL, USERS.security);
      contexts.push(security.context);
      await security.page.goto('/v1/guard');
      await expect(security.page.getByRole('heading', { name: /Пост (охраны|КПП)/ })).toBeVisible();
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

  test('cottage onboarding provisions checkpoint, policy, vehicle verify and manual decision', async ({ browser, baseURL }) => {
    test.skip(
      e2eEnv.E2E_PROPERTY_TYPE !== 'cottage_community',
      'set E2E_PROPERTY_TYPE=cottage_community to run cottage-community onboarding smoke',
    );

    const stamp = Date.now();
    const checkpointName = `DH20 КПП ${stamp}`;
    const policyName = `DH20 vehicle policy ${stamp}`;
    const plate = uniquePlate(stamp);
    const manualPlate = uniquePlate(stamp + 1);
    const contexts = [];

    try {
      const admin = await newAuthedPage(browser, baseURL, USERS.admin);
      contexts.push(admin.context);

      await admin.page.goto('/v1/onboarding');
      await expect(admin.page.getByRole('heading', { name: 'Онбординг объекта' })).toBeVisible();
      await expect(admin.page.getByText('Импорт домов/участков')).toBeVisible();

      const meResponse = await admin.page.request.get('/api/v1/auth/me');
      expect(meResponse.status()).toBe(200);
      const me = await meResponse.json();
      const propertyId = me.user.property_id;
      expect(propertyId).toMatch(/^[0-9a-f-]{36}$/i);
      expect(me.user.property_type).toBe('cottage_community');

      const csv = [
        'sector_or_street,house_or_plot_number,unit_type,owner_full_name,phone,resident_type,vehicle_plates,checkpoint_name,checkpoint_type,checkpoint_notes',
        `DH20 Street,${stamp},house,DH20 Owner,+7900${String(stamp).slice(-7)},owner,${plate},${checkpointName},checkpoint,Main gate smoke`,
      ].join('\n');

      await admin.page.getByRole('textbox', { name: /sector_or_street/ }).fill(csv);
      const importResponsePromise = admin.page.waitForResponse((response) =>
        response.url().includes('/api/v1/units/import') &&
        response.request().method() === 'POST' &&
        response.status() === 201,
      );
      await admin.page.getByRole('button', { name: 'Импортировать' }).click();
      const importBody = await (await importResponsePromise).json();
      expect(importBody.readiness.ready).toBe(true);
      expect(importBody.readiness.planned_access_points).toBe(1);
      expect(importBody.access_topology.points).toHaveLength(1);
      expect(importBody.access_topology.points[0].name).toBe(checkpointName);
      await expect(admin.page.getByText(new RegExp(`КПП: ${checkpointName}`))).toBeVisible();

      const accessPointId = importBody.access_topology.points[0].id;
      const policyResponse = await postJson(admin.page, baseURL, '/api/v1/access-policies', {
        property_id: propertyId,
        name: policyName,
        subject_type: 'vehicle',
        point_id: accessPointId,
        access_method: 'plate',
        approval_mode: 'auto',
        effect: 'allow',
        priority: -1000,
        is_recurring: true,
        metadata: { source: 'dh20_e2e' },
      });
      expect(policyResponse.status()).toBe(201);
      const policyBody = await policyResponse.json();
      expect(policyBody.policy.name).toBe(policyName);

      const security = await newAuthedPage(browser, baseURL, USERS.security);
      contexts.push(security.context);

      await security.page.goto('/v1/guard');
      await expect(security.page.getByRole('heading', { name: 'Пост КПП' })).toBeVisible();
      await expect(security.page.getByRole('tab', { name: 'Въезд авто' })).toHaveAttribute('aria-selected', 'true');
      await expect(security.page.getByText(/Vehicle-first режим/i)).toBeVisible();

      const pointSelect = security.page.getByLabel('КПП / точка доступа');
      await expect(pointSelect).toContainText(checkpointName);
      await pointSelect.selectOption(accessPointId);
      await security.page.getByLabel('Режим сканирования').selectOption('plate');
      await security.page.getByLabel('Гос. номер').fill(plate);

      const verifyResponsePromise = security.page.waitForResponse((response) =>
        response.url().includes('/api/v1/visits/verify') &&
        response.request().method() === 'POST' &&
        response.status() === 200,
      );
      await security.page.getByRole('button', { name: 'Проверить' }).click();
      const verifyBody = await (await verifyResponsePromise).json();
      expect(verifyBody.allowed).toBe(true);
      expect(verifyBody.direction).toBe('entry');
      expect(verifyBody.policy_decision.reason).toBe('policy_allowed');
      expect(verifyBody.policy_decision.matched_policy_name).toBe(policyName);
      await expect(security.page.getByText('Проход разрешён')).toBeVisible();

      const manualCard = security.page.locator('section').filter({
        has: security.page.getByRole('heading', { name: 'Ручное решение' }),
      });
      await manualCard.getByPlaceholder('ФИО, подрядчик или описание').fill('DH20 Manual Guest');
      await manualCard.getByPlaceholder('A001AA77').fill(manualPlate);
      await manualCard.getByPlaceholder('Коротко зафиксируйте основание').fill('DH20 smoke manual admit');

      const manualResponsePromise = security.page.waitForResponse((response) =>
        response.url().includes('/api/v1/security-workspace/manual-decision') &&
        response.request().method() === 'POST' &&
        response.status() === 201,
      );
      await manualCard.getByRole('button', { name: 'Записать' }).click();
      const manualBody = await (await manualResponsePromise).json();
      expect(manualBody.visit_log.access_point_id).toBe(accessPointId);
      expect(manualBody.visit_log.event_type).toBe('manual_admit');
      expect(manualBody.visit_log.provider_payload.direction).toBe('entry');
      expect(manualBody.incident.incident_type).toBe('manual_override');
      expect(manualBody.override.override_type).toBe('manual_admit');
    } finally {
      await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    }
  });

  test('cross-tenant JWT replay is rejected before property-scoped access', async ({ browser, baseURL }) => {
    const origin = originFromBaseURL(baseURL);
    const context = await browser.newContext({ baseURL: origin });
    const page = await context.newPage();
    try {
      const response = await page.request.get('/api/v1/auth/me', {
        headers: {
          Cookie: `token=${signJwt(USERS.resident, { property_slug: 'other-property' })}`,
          'X-Property-Slug': propertySlug,
        },
      });

      expect(response.status()).toBe(403);
      const body = await response.json();
      expect(body.error).toBe('Cross-tenant access denied');
    } finally {
      await context.close();
    }
  });
});
