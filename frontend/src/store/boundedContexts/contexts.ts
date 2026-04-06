import { createContext } from 'react';
import type { RequestsState } from '../slices/requestsSlice';
import type { ChatState } from '../slices/chatSlice';
import type { UsersState } from '../slices/usersSlice';
import type { PermsState } from '../slices/permsSlice';
import type { BlacklistEntry } from '../slices/blacklistSlice';
import type { GarageState } from '../slices/garageSlice';

export const RequestsContext = createContext<RequestsState | null>(null);
export const ChatContext = createContext<ChatState | null>(null);
export const UsersContext = createContext<UsersState | null>(null);
export const PermsContext = createContext<PermsState | null>(null);
export const BlacklistContext = createContext<BlacklistEntry[] | null>(null);
export const GarageContext = createContext<GarageState['garage'] | null>(null);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const DispatchContext = createContext<((action: any) => void) | null>(null);
