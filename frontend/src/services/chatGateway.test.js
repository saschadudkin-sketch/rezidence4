jest.mock('../config/runtimeMode', () => ({
  isLiveMode: jest.fn(),
}));

jest.mock('./firebaseService', () => ({
  sendMessage: jest.fn(),
}));

import { isLiveMode } from '../config/runtimeMode';
import { SYNC_STATUS } from '../constants/syncStatuses';
import { sendMessage as fbSendMessage } from './firebaseService';
import { sendChatMessage } from './chatGateway';

describe('chatGateway.sendChatMessage', () => {
  let warnSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test('demo mode sends locally', async () => {
    isLiveMode.mockReturnValue(false);
    const sendLocal = jest.fn();

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
    const sendLocal = jest.fn();

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
    const sendLocal = jest.fn();

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
