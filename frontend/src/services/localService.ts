/**
 * services/localService.js
 * Локальные заглушки сервисного слоя для demo-режима.
 * В production используется backendProvider.js → apiClient.js → VPS API.
 */

export const createRequest       = async (..._args: unknown[]) => ({ mode: 'local' });
export const updateRequest       = async (..._args: unknown[]) => ({ mode: 'local' });
export const deleteRequest       = async (..._args: unknown[]) => ({ mode: 'local' });
export const uploadRequestPhoto  = async (_id: unknown, url: unknown) => url;
export const sendMessage         = async (..._args: unknown[]) => ({ mode: 'local' });
export const getAllUsers          = async (..._args: unknown[]) => [] as unknown[];
export const saveUser             = async (..._args: unknown[]) => ({ mode: 'local' });
export const removeUser           = async (..._args: unknown[]) => ({ mode: 'local' });
export const savePerms            = async (..._args: unknown[]) => ({ mode: 'local' });
export const saveTemplates        = async (..._args: unknown[]) => ({ mode: 'local' });
export const getTemplates         = async () => [];
export const getFirestorePerms    = async () => null;
export const subscribeRequests    = () => () => {};
export const subscribeChat        = () => () => {};
export const subscribeUsers       = () => () => {};
export const fetchAllUsers        = async () => [];
export const fetchPerms           = async () => null;
export const fetchTemplates       = async () => [];
