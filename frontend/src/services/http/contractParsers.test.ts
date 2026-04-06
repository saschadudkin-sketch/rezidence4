import {
  parseChatMessagesResponse,
  parseRequestsListResponse,
  parseUsersResponse,
} from './contractParsers';

describe('contractParsers', () => {
  test('parseChatMessagesResponse supports object payload', () => {
    const parsed = parseChatMessagesResponse({ messages: [{ id: 'm1' }], hasMore: true });
    expect(parsed.messages).toHaveLength(1);
    expect(parsed.hasMore).toBe(true);
  });

  test('parseRequestsListResponse supports paged payload', () => {
    const parsed = parseRequestsListResponse({ data: [{ id: 'r1' }], total: 10, nextPage: 2 });
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.total).toBe(10);
    expect(parsed.nextPage).toBe(2);
  });

  test('parseUsersResponse throws on non-array payload', () => {
    expect(() => parseUsersResponse({})).toThrow(/expected array/i);
  });
});
