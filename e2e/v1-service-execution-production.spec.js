const crypto = require('node:crypto');
const { test, expect } = require('./test');
const { buildE2EEnv } = require('../scripts/e2e-env.cjs');
const { stubExternalFontAssets } = require('./support/externalAssets');

const e2eEnv = buildE2EEnv(process.env);
const enabled = e2eEnv.E2E_V1_SERVICE_EXECUTION === '1' || e2eEnv.E2E_BACKEND_MODE === '1';
const propertySlug = e2eEnv.E2E_PROPERTY_SLUG || 'zamoskv';
const jwtSecret = e2eEnv.JWT_SECRET || 'ci-dummy-jwt-secret-32chars-padding-ok';
const csrfToken = 's'.repeat(64);

const USERS = {
  admin: {
    uid: 'e2e-v1-admin',
    role: 'admin',
    name: 'E2E Property Admin',
  },
  technician: {
    uid: 'e2e-v1-technician',
    role: 'technician',
    name: 'E2E Technician',
  },
  contractor: {
    uid: 'e2e-v1-contractor',
    role: 'contractor',
    name: 'E2E Contractor',
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

function requestRow(page, testId, requestId) {
  return page.locator(`[data-testid="${testId}"][data-request-id="${requestId}"]`);
}

async function postV1(page, path, data = {}) {
  const origin = new URL(page.url()).origin;
  return page.request.post(path, {
    headers: {
      Origin: origin,
      'X-CSRF-Token': csrfToken,
    },
    data,
  });
}

async function openWorkspaceViaRoleNavigation(page, { linkName, urlPattern, headingName }) {
  await page.goto('/v1');
  const nav = page.getByRole('navigation', { name: 'Пилотная навигация операций' });
  await expect(nav).toBeVisible();
  await nav.getByRole('link', { name: linkName }).click();
  await expect(page).toHaveURL(urlPattern);
  await expect(page.getByRole('heading', { name: headingName })).toBeVisible();
}

async function openStaffWorkspaceViaRoleNavigation(page) {
  await openWorkspaceViaRoleNavigation(page, {
    linkName: 'Staff',
    urlPattern: /\/v1\/staff-workspace$/,
    headingName: 'Рабочее место staff',
  });
}

async function openTechnicianWorkspaceViaRoleNavigation(page) {
  await openWorkspaceViaRoleNavigation(page, {
    linkName: 'Техник',
    urlPattern: /\/v1\/technician-workspace$/,
    headingName: 'Рабочее место техника',
  });
}

async function openContractorWorkspaceViaRoleNavigation(page) {
  await openWorkspaceViaRoleNavigation(page, {
    linkName: 'Подрядчик',
    urlPattern: /\/v1\/contractor-workspace$/,
    headingName: 'Портал подрядчика',
  });
}

async function createCanonicalRequest(page, requestComment) {
  await openStaffWorkspaceViaRoleNavigation(page);
  await expect(page.getByText('Canonical requests')).toBeVisible();

  await page.locator('#staff-canonical-category-code').fill('plumber');
  await page.locator('#staff-canonical-comment').fill(requestComment);
  const createResponse = page.waitForResponse((response) =>
    response.url().includes('/api/v1/requests') &&
    response.request().method() === 'POST' &&
    response.status() === 201,
  );
  await page.getByRole('button', { name: 'Создать canonical request' }).click();
  const request = await (await createResponse).json();
  expect(request.id).toBeTruthy();
  return request;
}

async function assignTechnician(page, requestId) {
  await page.locator('#staff-canonical-request-id').fill(requestId);
  await page.locator('#staff-canonical-assignee-uid').fill(USERS.technician.uid);
  await page.locator('#staff-canonical-assignee-role').selectOption('technician');
  const assignResponse = page.waitForResponse((response) =>
    response.url().includes(`/api/v1/requests/${requestId}/assign`) &&
    response.request().method() === 'POST' &&
    response.status() === 200,
  );
  await page.getByRole('button', { name: 'Назначить canonical' }).click();
  const assigned = await (await assignResponse).json();
  expect(assigned.assignedToRole).toBe('technician');

  await page.locator('#staff-canonical-next-status').selectOption('assigned');
  const statusResponse = page.waitForResponse((response) =>
    response.url().includes(`/api/v1/requests/${requestId}`) &&
    response.request().method() === 'PATCH' &&
    response.status() === 200,
  );
  await page.getByRole('button', { name: 'Обновить request' }).click();
  const statusUpdated = await (await statusResponse).json();
  expect(statusUpdated.status).toBe('assigned');
}

async function getContractorUserId(page, propertyId) {
  const response = await page.request.get(`/api/v1/contractor-users?property_id=${propertyId}&is_active=true&limit=50`);
  expect(response.status()).toBe(200);
  const payload = await response.json();
  const contractor = payload.users.find((user) => user.external_uid === USERS.contractor.uid);
  expect(contractor?.id).toMatch(/^[0-9a-f-]{36}$/i);
  return contractor.id;
}

async function assignContractor(page, requestId, contractorUserId) {
  await openContractorWorkspaceViaRoleNavigation(page);
  const form = page.getByTestId('contractor-assignment-form');
  await form.locator('#contractor-assign-request-id').fill(requestId);
  await form.locator('#contractor-assign-user-id').fill(contractorUserId);
  await form.locator('#contractor-assign-note').fill('Phase 8 contractor handoff');
  const assignResponse = page.waitForResponse((response) =>
    response.url().includes(`/api/v1/contractor-workspace/requests/${requestId}/assign`) &&
    response.request().method() === 'POST' &&
    response.status() === 200,
  );
  await form.getByRole('button', { name: 'Назначить подрядчика' }).click();
  const assigned = await (await assignResponse).json();
  expect(assigned.request.assignedToRole).toBe('contractor');
  expect(assigned.request.assignedContractorUserId).toBe(contractorUserId);
}

async function executeTechnicianWork(page, requestId, resolutionNote) {
  await openTechnicianWorkspaceViaRoleNavigation(page);
  const row = requestRow(page, 'technician-task-row', requestId);
  await expect(row).toBeVisible();
  await row.click();

  const startResponse = page.waitForResponse((response) =>
    response.url().includes(`/api/v1/technician-workspace/requests/${requestId}/start`) &&
    response.request().method() === 'POST' &&
    response.status() === 200,
  );
  await page.getByRole('button', { name: 'Начать' }).click();
  expect((await (await startResponse).json()).request.status).toBe('in_progress');

  await page.locator('#technician-waiting-note').fill('Phase 8 waiting for parts');
  const waitingResponse = page.waitForResponse((response) =>
    response.url().includes(`/api/v1/technician-workspace/requests/${requestId}/waiting`) &&
    response.request().method() === 'POST' &&
    response.status() === 200,
  );
  await page.getByRole('button', { name: 'Поставить на ожидание' }).click();
  expect((await (await waitingResponse).json()).request.status).toBe('waiting_parts');

  const resumeResponse = page.waitForResponse((response) =>
    response.url().includes(`/api/v1/technician-workspace/requests/${requestId}/resume`) &&
    response.request().method() === 'POST' &&
    response.status() === 200,
  );
  await page.getByRole('button', { name: 'Возобновить' }).click();
  expect((await (await resumeResponse).json()).request.status).toBe('in_progress');

  await page.locator('#technician-resolution').fill(resolutionNote);
  const resolveResponse = page.waitForResponse((response) =>
    response.url().includes(`/api/v1/technician-workspace/requests/${requestId}/resolve`) &&
    response.request().method() === 'POST' &&
    response.status() === 200,
  );
  await page.getByRole('button', { name: 'Завершить задачу' }).click();
  const resolved = await (await resolveResponse).json();
  expect(resolved.request.status).toBe('resolved');
  expect(resolved.request.resolutionNote).toBe(resolutionNote);
}

async function executeContractorWork(page, requestId, resolutionNote) {
  await openContractorWorkspaceViaRoleNavigation(page);
  const row = requestRow(page, 'contractor-job-row', requestId);
  await expect(row).toBeVisible();
  await row.click();

  const startResponse = page.waitForResponse((response) =>
    response.url().includes(`/api/v1/contractor-workspace/requests/${requestId}/start`) &&
    response.request().method() === 'POST' &&
    response.status() === 200,
  );
  await page.getByRole('button', { name: 'Начать' }).click();
  expect((await (await startResponse).json()).request.status).toBe('in_progress');

  await page.locator('#contractor-waiting-note').fill('Phase 8 waiting for contractor parts');
  const waitingResponse = page.waitForResponse((response) =>
    response.url().includes(`/api/v1/contractor-workspace/requests/${requestId}/waiting`) &&
    response.request().method() === 'POST' &&
    response.status() === 200,
  );
  await page.getByRole('button', { name: 'Ждём материалы' }).click();
  expect((await (await waitingResponse).json()).request.status).toBe('waiting_parts');

  const resumeResponse = page.waitForResponse((response) =>
    response.url().includes(`/api/v1/contractor-workspace/requests/${requestId}/resume`) &&
    response.request().method() === 'POST' &&
    response.status() === 200,
  );
  await page.getByRole('button', { name: 'Возобновить' }).click();
  expect((await (await resumeResponse).json()).request.status).toBe('in_progress');

  await page.locator('#contractor-resolution').fill(resolutionNote);
  const resolveResponse = page.waitForResponse((response) =>
    response.url().includes(`/api/v1/contractor-workspace/requests/${requestId}/resolve`) &&
    response.request().method() === 'POST' &&
    response.status() === 200,
  );
  await page.getByRole('button', { name: 'Сдать работу' }).click();
  const resolved = await (await resolveResponse).json();
  expect(resolved.request.status).toBe('resolved');
  expect(resolved.request.resolutionNote).toBe(resolutionNote);
}

test.describe('platform-v1 service execution production e2e', () => {
  test.skip(!enabled, 'backend-backed v1 service execution e2e is enabled with E2E_V1_SERVICE_EXECUTION=1');

  test('staff assigns service work to technician and contractor, then execution roles finish through UI', async ({ browser, baseURL }) => {
    test.setTimeout(120_000);

    const contexts = [];
    const runtimeErrors = [];
    const stamp = Date.now();

    try {
      const admin = await newAuthedPage(browser, baseURL, USERS.admin);
      const technician = await newAuthedPage(browser, baseURL, USERS.technician);
      const contractor = await newAuthedPage(browser, baseURL, USERS.contractor);
      contexts.push(admin.context, technician.context, contractor.context);
      attachRuntimeGuards(admin.page, runtimeErrors);
      attachRuntimeGuards(technician.page, runtimeErrors);
      attachRuntimeGuards(contractor.page, runtimeErrors);

      const meResponse = await admin.page.request.get('/api/v1/auth/me');
      expect(meResponse.status()).toBe(200);
      const me = await meResponse.json();
      const propertyId = me.user.property_id;
      expect(propertyId).toMatch(/^[0-9a-f-]{36}$/i);

      const technicianRequest = await createCanonicalRequest(
        admin.page,
        `Phase8 technician service execution ${stamp}`,
      );
      await assignTechnician(admin.page, technicianRequest.id);
      await executeTechnicianWork(
        technician.page,
        technicianRequest.id,
        `Phase8 technician resolution ${stamp}`,
      );

      const contractorRequest = await createCanonicalRequest(
        admin.page,
        `Phase8 contractor service execution ${stamp}`,
      );
      const contractorUserId = await getContractorUserId(admin.page, propertyId);
      await assignContractor(admin.page, contractorRequest.id, contractorUserId);
      await executeContractorWork(
        contractor.page,
        contractorRequest.id,
        `Phase8 contractor resolution ${stamp}`,
      );

      await openStaffWorkspaceViaRoleNavigation(admin.page);
      await admin.page.locator('#staff-search').fill(String(stamp));
      await expect(admin.page.locator(`[data-testid="staff-request-row"][data-request-id="${technicianRequest.id}"]`)).toBeVisible();
      await admin.page.locator(`[data-testid="staff-request-row"][data-request-id="${technicianRequest.id}"]`).click();
      await expect(admin.page.getByText(`Phase8 technician resolution ${stamp}`).first()).toBeVisible();
      await expect(admin.page.locator(`[data-testid="staff-request-row"][data-request-id="${contractorRequest.id}"]`)).toBeVisible();
      await admin.page.locator(`[data-testid="staff-request-row"][data-request-id="${contractorRequest.id}"]`).click();
      await expect(admin.page.getByText(`Phase8 contractor resolution ${stamp}`).first()).toBeVisible();

      expect(runtimeErrors).toEqual([]);
    } finally {
      await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    }
  });

  test('service execution role and stale-state errors stay understandable', async ({ browser, baseURL }) => {
    const contexts = [];
    const stamp = Date.now();

    try {
      const admin = await newAuthedPage(browser, baseURL, USERS.admin);
      const technician = await newAuthedPage(browser, baseURL, USERS.technician);
      const contractor = await newAuthedPage(browser, baseURL, USERS.contractor);
      contexts.push(admin.context, technician.context, contractor.context);

      const request = await createCanonicalRequest(
        admin.page,
        `Phase8 technician stale execution ${stamp}`,
      );
      await assignTechnician(admin.page, request.id);

      await openContractorWorkspaceViaRoleNavigation(contractor.page);
      const forbiddenTechnicianStart = await postV1(
        contractor.page,
        `/api/v1/technician-workspace/requests/${request.id}/start`,
      );
      expect(forbiddenTechnicianStart.status()).toBe(403);

      await openTechnicianWorkspaceViaRoleNavigation(technician.page);
      const row = requestRow(technician.page, 'technician-task-row', request.id);
      await expect(row).toBeVisible();
      await row.click();
      await expect(technician.page.getByRole('button', { name: 'Начать' })).toBeVisible();

      const directStart = await postV1(
        technician.page,
        `/api/v1/technician-workspace/requests/${request.id}/start`,
      );
      expect(directStart.status()).toBe(200);

      const conflictResponse = technician.page.waitForResponse((response) =>
        response.url().includes(`/api/v1/technician-workspace/requests/${request.id}/start`) &&
        response.request().method() === 'POST' &&
        response.status() === 409,
      );
      await technician.page.getByRole('button', { name: 'Начать' }).click();
      const conflict = await (await conflictResponse).json();
      expect(conflict.error).toContain('Request cannot be started');
      await expect(
        technician.page.getByText('Задача уже изменилась. Детали обновляются; проверьте актуальный статус и повторите действие.'),
      ).toBeVisible();
      await expect(technician.page.getByText(/Request cannot be started/)).toHaveCount(0);
    } finally {
      await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    }
  });
});
