import { createDemoProvider } from './demoProvider';

describe('demoProvider', () => {
  test('chat send uses local path only', async () => {
    const provider = createDemoProvider();
    const sendLocal = jest.fn();

    const mode = await provider.chat.sendMessage({
      localMessage: { text: 'hi' },
      sendLocal,
    });

    expect(mode).toBe('local');
    expect(sendLocal).toHaveBeenCalledWith({ text: 'hi' });
  });

  test('requests submit/update/delete use local path only', () => {
    const provider = createDemoProvider();
    const addLocal = jest.fn();
    const updateLocal = jest.fn();
    const deleteLocal = jest.fn();

    const submitMode = provider.requests.submit({ request: { id: 'r1' }, addLocal });
    provider.requests.updateEverywhere({ requestId: 'r1', patch: { comment: 'x' }, updateLocal });
    provider.requests.deleteEverywhere({ requestId: 'r1', deleteLocal });

    expect(submitMode).toBe('local');
    expect(addLocal).toHaveBeenCalledWith({ id: 'r1' });
    expect(updateLocal).toHaveBeenCalledWith('r1', { comment: 'x' });
    expect(deleteLocal).toHaveBeenCalledWith('r1');
  });

  test('liveData sync is no-op and returns cleanup fn', () => {
    const provider = createDemoProvider();
    const stop = provider.liveData.startSync();
    expect(typeof stop).toBe('function');
    expect(() => stop()).not.toThrow();
  });
});
