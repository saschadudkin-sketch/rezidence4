export type EntityRow = Record<string, unknown> & { id?: string; uid?: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asRows(value: unknown): EntityRow[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is EntityRow => isObject(row));
}

export function parseChatMessagesResponse(payload: unknown): { messages: EntityRow[]; hasMore: boolean } {
  if (Array.isArray(payload)) {
    return { messages: asRows(payload), hasMore: false };
  }
  if (!isObject(payload)) {
    throw new Error('Invalid chat response: expected object or array');
  }
  const messages = asRows(payload.messages ?? []);
  const hasMore = Boolean(payload.hasMore);
  return { messages, hasMore };
}

export function parseRequestsListResponse(payload: unknown): { rows: EntityRow[]; total: number; nextCursor: string | null; nextPage: number | null } {
  if (Array.isArray(payload)) {
    return {
      rows: asRows(payload),
      total: payload.length,
      nextCursor: null,
      nextPage: null,
    };
  }
  if (!isObject(payload)) {
    throw new Error('Invalid requests response: expected object or array');
  }
  const rows = asRows(payload.data ?? []);
  const total = Number(payload.total ?? rows.length ?? 0);
  const nextCursor = typeof payload.nextCursor === 'string'
    ? payload.nextCursor
    : (typeof payload.cursor === 'string' ? payload.cursor : null);
  const nextPage = Number(payload.nextPage ?? 0) || null;
  return { rows, total, nextCursor, nextPage };
}

export function parseUsersResponse(payload: unknown): EntityRow[] {
  if (!Array.isArray(payload)) {
    throw new Error('Invalid users response: expected array');
  }
  return asRows(payload);
}
