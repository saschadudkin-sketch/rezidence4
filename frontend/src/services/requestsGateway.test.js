jest.mock('../config/runtimeMode', () => ({
  isLiveMode: jest.fn(),
}));

jest.mock('./firebaseService', () => ({
  createRequest: jest.fn(),
  uploadRequestPhoto: jest.fn(),
  updateRequest: jest.fn(),
  deleteRequest: jest.fn(),
}));

import { isLiveMode } from '../config/runtimeMode';
import { SYNC_STATUS } from '../constants/syncStatuses';
import { createRequest, uploadRequestPhoto, updateRequest, deleteRequest } from './firebaseService';
import { resolveRequestPhotos, submitRequest, updateRequestEverywhere, deleteRequestEverywhere } from './requestsGateway';

describe('requestsGateway', () => {
  let warnSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    createRequest.mockResolvedValue(undefined);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test('resolveRequestPhotos returns local photos in demo mode', async () => {
    isLiveMode.mockReturnValue(false);
    const photos = ['a', 'b'];
    const result = await resolveRequestPhotos('r1', photos);
    expect(result).toEqual(['a', 'b']);
    expect(uploadRequestPhoto).not.toHaveBeenCalled();
  });

  test('resolveRequestPhotos uploads photos in live mode', async () => {
    isLiveMode.mockReturnValue(true);
    uploadRequestPhoto
      .mockResolvedValueOnce('u1')
      .mockResolvedValueOnce('u2');

    const result = await resolveRequestPhotos('r2', ['a', 'b']);
    expect(result).toEqual(['u1', 'u2']);
    expect(uploadRequestPhoto).toHaveBeenCalledTimes(2);
  });

  test('submitRequest sends remote in live mode', async () => {
    isLiveMode.mockReturnValue(true);
    const addLocal = jest.fn();

    const mode = await submitRequest({ request: { id: 'r3' }, addLocal });

    expect(mode).toBe(SYNC_STATUS.REMOTE);
    expect(createRequest).toHaveBeenCalledTimes(1);
    expect(addLocal).not.toHaveBeenCalled();
  });

  test('submitRequest falls back to local when remote fails in live mode', async () => {
    isLiveMode.mockReturnValue(true);
    createRequest.mockRejectedValueOnce(new Error('offline'));
    const addLocal = jest.fn();

    const mode = await submitRequest({ request: { id: 'r3f' }, addLocal });

    expect(mode).toBe(SYNC_STATUS.LOCAL_FALLBACK);
    expect(addLocal).toHaveBeenCalledWith({ id: 'r3f' });
  });

  test('submitRequest sends local in demo mode', async () => {
    isLiveMode.mockReturnValue(false);
    const addLocal = jest.fn();

    const mode = await submitRequest({ request: { id: 'r4' }, addLocal });

    expect(mode).toBe(SYNC_STATUS.LOCAL);
    expect(addLocal).toHaveBeenCalledTimes(1);
  });

  test('updateRequestEverywhere updates local only in demo mode', async () => {
    isLiveMode.mockReturnValue(false);
    const updateLocal = jest.fn();

    const mode = await updateRequestEverywhere({ requestId: 'r5', patch: { comment: 'x' }, updateLocal });

    expect(mode).toBe(SYNC_STATUS.LOCAL);
    expect(updateLocal).toHaveBeenCalledWith('r5', { comment: 'x' });
    expect(updateRequest).not.toHaveBeenCalled();
  });

  test('updateRequestEverywhere updates local + remote in live mode', async () => {
    isLiveMode.mockReturnValue(true);
    const updateLocal = jest.fn();
    updateRequest.mockResolvedValue(undefined);

    const mode = await updateRequestEverywhere({ requestId: 'r6', patch: { comment: 'y' }, updateLocal });

    expect(mode).toBe(SYNC_STATUS.REMOTE);
    expect(updateLocal).toHaveBeenCalledWith('r6', { comment: 'y' });
    expect(updateRequest).toHaveBeenCalledWith('r6', { comment: 'y' });
  });

  test('updateRequestEverywhere falls back to local when remote update fails', async () => {
    isLiveMode.mockReturnValue(true);
    const updateLocal = jest.fn();
    updateRequest.mockRejectedValueOnce(new Error('offline'));

    const mode = await updateRequestEverywhere({ requestId: 'r6f', patch: { comment: 'y' }, updateLocal });

    expect(mode).toBe(SYNC_STATUS.LOCAL_FALLBACK);
    expect(updateLocal).toHaveBeenCalledWith('r6f', { comment: 'y' });
  });

  test('deleteRequestEverywhere removes local only in demo mode', async () => {
    isLiveMode.mockReturnValue(false);
    const deleteLocal = jest.fn();

    const mode = await deleteRequestEverywhere({ requestId: 'r7', deleteLocal });

    expect(mode).toBe(SYNC_STATUS.LOCAL);
    expect(deleteLocal).toHaveBeenCalledWith('r7');
    expect(deleteRequest).not.toHaveBeenCalled();
  });

  test('deleteRequestEverywhere removes local + remote in live mode', async () => {
    isLiveMode.mockReturnValue(true);
    const deleteLocal = jest.fn();
    deleteRequest.mockResolvedValue(undefined);

    const mode = await deleteRequestEverywhere({ requestId: 'r8', deleteLocal });

    expect(mode).toBe(SYNC_STATUS.REMOTE);
    expect(deleteLocal).toHaveBeenCalledWith('r8');
    expect(deleteRequest).toHaveBeenCalledWith('r8');
  });

  test('deleteRequestEverywhere falls back to local when remote delete fails', async () => {
    isLiveMode.mockReturnValue(true);
    const deleteLocal = jest.fn();
    deleteRequest.mockRejectedValueOnce(new Error('offline'));

    const mode = await deleteRequestEverywhere({ requestId: 'r8f', deleteLocal });

    expect(mode).toBe(SYNC_STATUS.LOCAL_FALLBACK);
    expect(deleteLocal).toHaveBeenCalledWith('r8f');
  });
});
