import { logger } from '../../services/logger';
import {
  REQUESTS_ACTIONS,
  CHAT_ACTIONS,
  USERS_ACTIONS,
  PERMS_ACTIONS,
  BLACKLIST_ACTIONS,
  GARAGE_ACTIONS,
} from '../actionDomains';
import type { AppStoreAction } from './contexts';

const DOMAIN_TO_ACTIONS = {
  requests: REQUESTS_ACTIONS,
  chat: CHAT_ACTIONS,
  users: USERS_ACTIONS,
  perms: PERMS_ACTIONS,
  blacklist: BLACKLIST_ACTIONS,
  garage: GARAGE_ACTIONS,
};

export function routeDomainDispatch(action: AppStoreAction, dispatchers: Record<string, ((action: AppStoreAction) => void) | undefined>) {
  for (const [domain, actionSet] of Object.entries(DOMAIN_TO_ACTIONS)) {
    if (actionSet.has(action.type)) {
      return dispatchers[domain]?.(action);
    }
  }
  logger.warn('[AppStore] Unmatched action type:', action.type);
  return undefined;
}
