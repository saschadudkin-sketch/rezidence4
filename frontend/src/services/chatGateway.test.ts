vi.mock('../config/runtimeMode', () => ({
  isLiveMode: vi.fn(),
}));

vi.mock('./localService', () => ({
  sendMessage: vi.fn(),
}));

import { isLiveMode } from '../config/runtimeMode';
import { SYNC_STATUS } from '../constants/syncStatuses';
import { sendMessage as fbSendMessage } from './localService';
import { sendChatMessage } from './chatGateway';

describe('chatGateway.sendChatMessage', () => {
  let warnSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test('demo mode sends locally', async () => {
    isLiveMode.mockReturnValue(false);
    const sendLocal = vi.fn();

    const mode = await sendChatMessage({
      remotePayload: { text: 'hello' },
      localMessage: { text: 'hello' },
      sendLocal,
    });

    expect(mode).toBe(SYNC_STATUS.LOCAL);
    expect(sendLocal).toHaveBeenCalledTimes(1);
    expect(fbSendMessage).not.toHaveBeenCalled();
  });

  test('live mode sends remotely', async () => {
    isLiveMode.mockReturnValue(true);
    fbSendMessage.mockResolvedValue(undefined);
    const sendLocal = vi.fn();

    const mode = await sendChatMessage({
      remotePayload: { text: 'hello' },
      localMessage: { text: 'hello' },
      sendLocal,
    });

    expect(mode).toBe(SYNC_STATUS.REMOTE);
    expect(fbSendMessage).toHaveBeenCalledTimes(1);
    expect(sendLocal).not.toHaveBeenCalled();
  });

  test('live mode falls back to local on remote error', async () => {
    isLiveMode.mockReturnValue(true);
    fbSendMessage.mockRejectedValue(new Error('network'));
    const sendLocal = vi.fn();

    const mode = await sendChatMessage({
      remotePayload: { text: 'hello' },
      localMessage: { text: 'hello' },
      sendLocal,
    });

    expect(mode).toBe(SYNC_STATUS.LOCAL);
    expect(sendLocal).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});
