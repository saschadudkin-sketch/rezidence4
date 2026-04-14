import type { RequestType } from '../store/slices/requestsSlice';
import type { UserRole } from '../store/slices/usersSlice';

export type CreateDraft = {
  cat: string;
  vName: string;
  vNames: string[];
  vPhone: string;
  carPlate: string;
  apartment: string;
  comment: string;
  validUntil: string;
  showSchedule: boolean;
  scheduledFor: string;
  residentStep?: number;
  showAdvanced?: boolean;
  updatedAt: number;
};

const DRAFT_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const STORAGE_PREFIX = 'rezidence4:create-draft';

export function getCreateDraftKey(userUid: string, userRole: UserRole | string, type: RequestType): string {
  return `${STORAGE_PREFIX}:${userUid}:${userRole}:${type}`;
}

function isCreateDraft(value: unknown): value is CreateDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Partial<CreateDraft>;
  return typeof draft.cat === 'string'
    && typeof draft.vName === 'string'
    && Array.isArray(draft.vNames)
    && typeof draft.vPhone === 'string'
    && typeof draft.carPlate === 'string'
    && typeof draft.apartment === 'string'
    && typeof draft.comment === 'string'
    && typeof draft.validUntil === 'string'
    && typeof draft.showSchedule === 'boolean'
    && typeof draft.scheduledFor === 'string'
    && typeof draft.updatedAt === 'number';
}

export function loadCreateDraft(key: string): CreateDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isCreateDraft(parsed)) {
      window.localStorage.removeItem(key);
      return null;
    }
    if (Date.now() - parsed.updatedAt > DRAFT_TTL_MS) {
      window.localStorage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveCreateDraft(key: string, draft: Omit<CreateDraft, 'updatedAt'>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify({ ...draft, updatedAt: Date.now() } satisfies CreateDraft));
  } catch {
    // Autosave is best-effort only.
  }
}

export function clearCreateDraft(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage failures.
  }
}
