import { validatePassByRules } from '../../domain/passValidation';
import { isLiveMode as isLiveMode } from '../../config/runtimeMode';
import type { VisitLogPage } from '../../services/http/visitLogs';

const DEMO_VISIT_LOGS_KEY = 'residenze_demo_visit_logs_v1';

type PassRecord = Record<string, unknown> & {
  id?: string;
  createdAt?: string;
};

type ValidationContext = NonNullable<Parameters<typeof validatePassByRules>[1]>;

type VisitLogEntry = {
  id: string;
  userId: string;
  requestId?: string;
  timestamp: string;
  result: string;
  reason?: string;
  actorName?: string;
  actorRole?: string;
  visitorName?: string | null;
  category?: string;
  carPlate?: string;
  createdByApt?: string;
  createdByName?: string;
  createdByUid?: string | null;
  requestSnapshot?: Record<string, unknown>;
};

type VisitLogInput = Omit<VisitLogEntry, 'id'>;

type VisitLogsProvider = {
  add: (entry: VisitLogInput) => Promise<VisitLogEntry>;
  getAll: () => Promise<VisitLogPage<VisitLogEntry>>;
  clear: () => Promise<void>;
};

type PassesApiState = {
  getPasses: () => Promise<PassRecord[]>;
  createPass: (pass: PassRecord) => Promise<PassRecord>;
  validatePass: (passPayload: Record<string, unknown>, context?: ValidationContext) => ReturnType<typeof validatePassByRules>;
  logVisit: (entry: VisitLogInput) => Promise<VisitLogEntry>;
  getVisitLogs: () => Promise<VisitLogEntry[]>;
  clearVisitLogs: () => Promise<void>;
  __reset: () => void;
};

function createVisitLogSeed(now: number): VisitLogEntry[] {
  const hoursAgo = (hours: number) => new Date(now - hours * 3_600_000).toISOString();
  return [
    {
      id: 'v_demo_1',
      userId: 'u1',
      requestId: 'req_demo_1',
      timestamp: hoursAgo(1),
      result: 'allowed',
      reason: 'ok',
      actorName: 'Охрана',
      actorRole: 'security',
      visitorName: 'Дмитрий Орлов',
      category: 'guest',
      createdByApt: '12',
      createdByName: 'Михаил Волков',
      createdByUid: 'u1',
      requestSnapshot: { category: 'guest', visitorName: 'Дмитрий Орлов', passDuration: 'once' },
    },
    {
      id: 'v_demo_2',
      userId: 'u1',
      requestId: 'req_demo_2',
      timestamp: hoursAgo(3),
      result: 'allowed',
      reason: 'ok',
      actorName: 'Охрана',
      actorRole: 'security',
      visitorName: null,
      category: 'taxi',
      carPlate: 'А777ВВ77',
      createdByApt: '12',
      createdByName: 'Михаил Волков',
      createdByUid: 'u1',
      requestSnapshot: { category: 'taxi', carPlate: 'А777ВВ77', passDuration: 'once' },
    },
  ];
}

export function createPassesApiState(): PassesApiState {
  let passes: PassRecord[] = [];
  let visitLogs: VisitLogEntry[] = [];
  let idCounter = 0;

  const nextId = (prefix: string) => `${prefix}_${Date.now()}_${++idCounter}`;

  const loadVisitLogs = () => {
    try {
      if (typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem(DEMO_VISIT_LOGS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0) {
        visitLogs = parsed as VisitLogEntry[];
      }
    } catch {
      // ignore broken local demo data
    }
  };

  const saveVisitLogs = () => {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(DEMO_VISIT_LOGS_KEY, JSON.stringify(visitLogs));
    } catch {
      // ignore localStorage write issues
    }
  };

  loadVisitLogs();
  if (visitLogs.length === 0) visitLogs = createVisitLogSeed(Date.now());

  return {
    async getPasses() {
      return [...passes];
    },

    async createPass(pass) {
      const payload: PassRecord = {
        ...pass,
        id: typeof pass.id === 'string' ? pass.id : nextId('p'),
        createdAt: typeof pass.createdAt === 'string' ? pass.createdAt : new Date().toISOString(),
      };
      passes = [payload, ...passes];
      return payload;
    },

    validatePass(passPayload, context = {}) {
      return validatePassByRules(passPayload, context);
    },

    async logVisit({ userId, timestamp = new Date().toISOString(), result, ...rest }) {
      const entry: VisitLogEntry = { id: nextId('v'), userId, timestamp, result, ...rest };
      visitLogs = [entry, ...visitLogs];
      saveVisitLogs();
      return entry;
    },

    async getVisitLogs() {
      return [...visitLogs];
    },

    async clearVisitLogs() {
      visitLogs = [];
      saveVisitLogs();
    },

    __reset() {
      passes = [];
      visitLogs = [];
      try {
        if (typeof localStorage !== 'undefined') localStorage.removeItem(DEMO_VISIT_LOGS_KEY);
      } catch {
        // ignore localStorage cleanup issues
      }
    },
  };
}

const passesApiInstance = createPassesApiState();

export const getPasses = passesApiInstance.getPasses.bind(passesApiInstance);
export const createPass = passesApiInstance.createPass.bind(passesApiInstance);
export const validatePass = passesApiInstance.validatePass.bind(passesApiInstance);

let visitLogsProviderPromise: Promise<VisitLogsProvider> | null = null;

async function getVisitLogsProvider(): Promise<VisitLogsProvider> {
  if (!visitLogsProviderPromise) {
    visitLogsProviderPromise = import('../../services/providers/backendProvider')
      .then((module) => module.visitLogsProvider as VisitLogsProvider);
  }
  return visitLogsProviderPromise;
}

export async function logVisit(entry: VisitLogInput): Promise<VisitLogEntry> {
  if (isLiveMode()) {
    const provider = await getVisitLogsProvider();
    return provider.add(entry);
  }
  return passesApiInstance.logVisit(entry);
}

export async function getVisitLogs(): Promise<VisitLogPage<VisitLogEntry>> {
  if (isLiveMode()) {
    const provider = await getVisitLogsProvider();
    return provider.getAll();
  }
  const data = await passesApiInstance.getVisitLogs();
  return {
    data,
    total: data.length,
    page: 1,
    limit: Number.MAX_SAFE_INTEGER,
  };
}

export async function clearVisitLogs(): Promise<void> {
  if (isLiveMode()) {
    const provider = await getVisitLogsProvider();
    await provider.clear();
    return;
  }
  await passesApiInstance.clearVisitLogs();
}
