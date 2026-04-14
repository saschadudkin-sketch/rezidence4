import { createContext } from 'react';
import type { RequestsState } from '../slices/requestsSlice';
import type { ChatState } from '../slices/chatSlice';
import type { UsersState } from '../slices/usersSlice';
import type { PermsState } from '../slices/permsSlice';
import type { BlacklistState } from '../slices/blacklistSlice';
import type { GarageState } from '../slices/garageSlice';

export type AppStoreSnapshot = {
  reqState: RequestsState;
  chatState: ChatState;
  usersState: UsersState;
  permsState: PermsState;
  blacklistState: BlacklistState;
  garageState: GarageState;
};

export type AppStoreApi = {
  getState: () => AppStoreSnapshot;
  subscribe: (listener: () => void) => () => void;
};

export type AppStoreAction = {
  type: string;
  [key: string]: unknown;
};

export type AppDispatch = (action: AppStoreAction) => void;

export const StoreContext = createContext<AppStoreApi | null>(null);
export const DispatchContext = createContext<AppDispatch | null>(null);
