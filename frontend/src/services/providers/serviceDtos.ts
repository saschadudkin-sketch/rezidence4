import type { ChatMessage } from '../../store/slices/chatSlice';
import type { BlacklistEntry } from '../../store/slices/blacklistSlice';
import type { PermEntry, Template, UserPerms } from '../../store/slices/permsSlice';
import type { AppRequest } from '../../store/slices/requestsSlice';
import type { AppUser } from '../../store/slices/usersSlice';

export type SyncStatus = 'local' | 'remote' | 'local_fallback' | 'synced';
export type ServiceAck = { ok: true } | { ok: boolean };
export type ChatDeletePayload = { id: string };
export type ChatEventType = 'added' | 'updated' | 'deleted';

export type AuthUser = AppUser;
export type RequestDto = AppRequest;
export type ChatMessageDto = ChatMessage;
export type UserDto = AppUser;
export type BlacklistEntryDto = BlacklistEntry;
export type TemplateDto = Template;
export type PermsDto = UserPerms;

export type ChatMessageInput = Partial<ChatMessage> & {
  text?: string;
  remotePayload?: Record<string, unknown>;
  localMessage?: ChatMessage;
  sendLocal?: (message: ChatMessage) => void;
};

export type PermsPayload =
  | UserPerms
  | { visitors: readonly PermEntry[]; workers: readonly PermEntry[] }
  | Template[];

export type LiveSyncChatEvent = {
  type: ChatEventType;
  message?: ChatMessage;
  id?: string;
};
