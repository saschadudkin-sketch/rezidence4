/**
 * services/localService.js
 * Локальные заглушки сервисного слоя для demo-режима.
 * В production используется backendProvider.js → apiClient.js → VPS API.
 */

export const createRequest       = async () => ({ mode: 'local' });
export const updateRequest       = async () => ({ mode: 'local' });
export const deleteRequest       = async () => ({ mode: 'local' });
export const uploadRequestPhoto  = async (_id, url) => url;
export const sendMessage         = async () => ({ mode: 'local' });
export const getAllUsers          = async () => [];
export const saveUser             = async () => ({ mode: 'local' });
export const removeUser           = async () => ({ mode: 'local' });
export const restoreUser          = async () => ({ mode: 'local' });
export const listDeletedUsers     = async () => [];
export const savePerms            = async () => ({ mode: 'local' });
export const saveTemplates        = async () => ({ mode: 'local' });
export const getTemplates         = async () => [];
export const getFirestorePerms    = async () => null;
export const subscribeRequests    = () => () => {};
export const subscribeChat        = () => () => {};
export const subscribeUsers       = () => () => {};
export const fetchAllUsers        = async () => [];
export const fetchPerms           = async () => null;
export const fetchTemplates       = async () => [];
