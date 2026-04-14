import { logger } from '../../services/logger';
import {
  REQUESTS_ACTIONS,
  CHAT_ACTIONS,
  USERS_ACTIONS,
  PERMS_ACTIONS,
  BLACKLIST_ACTIONS,
  GARAGE_ACTIONS,
} from '../actionDomains';
import type { AppDispatch, AppStoreAction } from './contexts';

const DOMAIN_TO_ACTIONS = {
  requests: REQUESTS_ACTIONS,
  chat: CHAT_ACTIONS,
  users: USERS_ACTIONS,
  perms: PERMS_ACTIONS,
  blacklist: BLACKLIST_ACTIONS,
  garage: GARAGE_ACTIONS,
} as const;

type DomainKey = keyof typeof DOMAIN_TO_ACTIONS;
type DomainDispatchers = Record<DomainKey, AppDispatch | undefined>;

export function routeDomainDispatch(action: AppStoreAction, dispatchers: DomainDispatchers): void {
  for (const [domain, actionSet] of Object.entries(DOMAIN_TO_ACTIONS)) {
    if (actionSet.has(action.type)) {
      dispatchers[domain as DomainKey]?.(action);
      return;
    }
  }
  logger.warn('[AppStore] Unmatched action type:', action.type);
}
