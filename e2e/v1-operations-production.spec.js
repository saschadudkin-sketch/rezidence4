const crypto = require('node:crypto');
const { test, expect } = require('./test');
const { buildE2EEnv } = require('../scripts/e2e-env.cjs');

const e2eEnv = buildE2EEnv(process.env);
const enabled = e2eEnv.E2E_V1_OPERATIONS === '1' || e2eEnv.E2E_BACKEND_MODE === '1';
const propertySlug = e2eEnv.E2E_PROPERTY_SLUG || 'zamoskv';
const jwtSecret = e2eEnv.JWT_SECRET || 'ci-dummy-jwt-secret-32chars-padding-ok';
const csrfToken = 'b'.repeat(64);

const USERS = {
  resident: {
    uid: 'e2e-v1-resident',
    role: 'owner',
    name: 'E2E Resident',
  },
  admin: {
    uid: 'e2e-v1-admin',
    role: 'admin',
    name: 'E2E Property Admin',
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

async function postJson(page, baseURL, path, data) {
  return page.request.post(path, {
    data,
    headers: {
      Origin: originFromBaseURL(baseURL),
      'X-CSRF-Token': csrfToken,
    },
  });
}

async function patchJson(page, baseURL, path, data) {
  return page.request.patch(path, {
    data,
    headers: {
      Origin: originFromBaseURL(baseURL),
      'X-CSRF-Token': csrfToken,
    },
  });
}

async function getJson(page, path) {
  const response = await page.request.get(path);
  expect(response.status()).toBe(200);
  return response.json();
}

test.describe('platform-v1 operations production e2e', () => {
  test.skip(!enabled, 'backend-backed v1 operations e2e is enabled with E2E_V1_OPERATIONS=1');

  test('resident request is assigned to contractor, resolved, hidden internal notes stay staff-only, and outbox evidence is recorded', async ({ browser, baseURL }) => {
    const contexts = [];
    const stamp = Date.now();
    const publicUpdate = `Phase4 resident-visible update ${stamp}`;
    const internalComment = `Phase4 internal staff note ${stamp}`;
    const contractorResolution = `Phase4 contractor resolution ${stamp}`;

    try {
      const resident = await newAuthedPage(browser, baseURL, USERS.resident);
      const admin = await newAuthedPage(browser, baseURL, USERS.admin);
      const contractor = await newAuthedPage(browser, baseURL, USERS.contractor);
      contexts.push(resident.context, admin.context, contractor.context);

      const me = await getJson(admin.page, '/api/v1/auth/me');
      const propertyId = me.user.property_id;
      expect(propertyId).toMatch(/^[0-9a-f-]{36}$/i);

      const subscriptionResponse = await postJson(resident.page, baseURL, '/api/v1/push-subscriptions', {
        endpoint: `https://push.e2e.domhub.local/phase4/${stamp}`,
        keys: {
          p256dh: 'phase4-p256dh',
          auth: 'phase4-auth',
        },
        deviceName: 'Phase4 Playwright',
      });
      expect(subscriptionResponse.status()).toBe(201);

      const createResponse = await postJson(resident.page, baseURL, '/api/v1/requests', {
        type: 'tech',
        category: 'plumber',
        comment: `Phase4 leaking pipe ${stamp}`,
        createdByApt: 'E2E-1',
      });
      expect(createResponse.status()).toBe(201);
      const created = await createResponse.json();
      expect(created.status).toBe('pending');
      expect(created.createdByUid).toBe(USERS.resident.uid);

      const inbox = await getJson(
        admin.page,
        `/api/v1/staff-workspace/inbox?property_id=${propertyId}&queue=all&q=${stamp}&limit=20`,
      );
      expect(inbox.requests.some((request) => request.id === created.id)).toBe(true);

      const contractorUsers = await getJson(
        admin.page,
        `/api/v1/contractor-users?property_id=${propertyId}&is_active=true&limit=50`,
      );
      const contractorUser = contractorUsers.users.find((user) => user.external_uid === USERS.contractor.uid);
      expect(contractorUser).toBeTruthy();

      const internalResponse = await postJson(
        admin.page,
        baseURL,
        `/api/v1/staff-workspace/requests/${created.id}/internal-comments?property_id=${propertyId}`,
        { body: internalComment },
      );
      expect(internalResponse.status()).toBe(201);

      const residentUpdateResponse = await postJson(
        admin.page,
        baseURL,
        `/api/v1/requests/${created.id}/updates`,
        { body: publicUpdate, visibility: 'resident' },
      );
      expect(residentUpdateResponse.status()).toBe(201);

      const assignResponse = await postJson(
        admin.page,
        baseURL,
        `/api/v1/contractor-workspace/requests/${created.id}/assign`,
        {
          contractorUserId: contractorUser.id,
          note: 'Phase4 assign contractor',
        },
      );
      expect(assignResponse.status()).toBe(200);
      const assigned = await assignResponse.json();
      expect(assigned.request.status).toBe('assigned');
      expect(assigned.request.assignedToRole).toBe('contractor');
      expect(assigned.request.assignedContractorUserId).toBe(contractorUser.id);

      const contractorQueue = await getJson(
        contractor.page,
        `/api/v1/contractor-workspace/queue?status=assigned&limit=20`,
      );
      expect(contractorQueue.requests.some((request) => request.id === created.id)).toBe(true);

      const contractorDetailBefore = await getJson(
        contractor.page,
        `/api/v1/contractor-workspace/requests/${created.id}`,
      );
      expect(contractorDetailBefore.internalComments).toEqual([]);
      expect(contractorDetailBefore.residentUpdates.some((update) => update.body === publicUpdate)).toBe(true);

      const startResponse = await postJson(
        contractor.page,
        baseURL,
        `/api/v1/contractor-workspace/requests/${created.id}/start`,
        {},
      );
      expect(startResponse.status()).toBe(200);
      expect((await startResponse.json()).request.status).toBe('in_progress');

      const resolveResponse = await postJson(
        contractor.page,
        baseURL,
        `/api/v1/contractor-workspace/requests/${created.id}/resolve`,
        {
          resolutionNote: contractorResolution,
          requiresFollowUp: false,
        },
      );
      expect(resolveResponse.status()).toBe(200);
      expect((await resolveResponse.json()).request.status).toBe('resolved');

      const staffDetail = await getJson(
        admin.page,
        `/api/v1/staff-workspace/requests/${created.id}?property_id=${propertyId}`,
      );
      expect(staffDetail.internalComments.some((comment) => comment.body === internalComment)).toBe(true);
      expect(staffDetail.internalComments.some((comment) => comment.body === contractorResolution)).toBe(true);
      expect(staffDetail.residentUpdates.some((update) => update.body === publicUpdate)).toBe(true);

      const residentUpdates = await getJson(resident.page, `/api/v1/requests/${created.id}/updates`);
      expect(residentUpdates.data.some((update) => update.body === publicUpdate)).toBe(true);
      expect(residentUpdates.data.some((update) => update.body === internalComment)).toBe(false);
      expect(residentUpdates.data.some((update) => update.body === contractorResolution)).toBe(false);

      const completeResponse = await patchJson(
        admin.page,
        baseURL,
        `/api/v1/requests/${created.id}`,
        {
          status: 'completed',
          expectedCurrentStatus: 'resolved',
          historyLabel: 'Phase4 completed after contractor resolution',
        },
      );
      expect(completeResponse.status()).toBe(200);
      const completed = await completeResponse.json();
      expect(completed.status).toBe('completed');
      expect(completed.completedAt).toBeTruthy();

      const outbox = await getJson(
        admin.page,
        `/api/v1/admin/outbox?q=${created.id}&limit=20`,
      );
      expect(outbox.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event_type: 'request.completed',
            channel: 'web_push',
            recipient_type: 'resident',
            correlation_id: created.id,
            status: 'pending',
          }),
        ]),
      );
    } finally {
      await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    }
  });
});
