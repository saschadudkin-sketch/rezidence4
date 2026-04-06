import { createContext } from 'react';
import type { RequestsState } from '../slices/requestsSlice';
import type { ChatState } from '../slices/chatSlice';
import type { UsersState } from '../slices/usersSlice';
import type { PermsState } from '../slices/permsSlice';
import type { BlacklistEntry } from '../slices/blacklistSlice';
import type { GarageState } from '../slices/garageSlice';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const DispatchContext = createContext<((action: any) => void) | null>(null);

export type AppStateContextValue = {
  reqState: RequestsState;
  chatState: ChatState;
  usersState: UsersState;
  permsState: PermsState;
  blacklistValue: BlacklistEntry[];
  garageValue: GarageState['garage'];
};

export const AppStateContext = createContext<AppStateContextValue | null>(null);
