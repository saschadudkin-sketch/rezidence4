import {
  useRequests, useChat, useActions, useBlacklist,
} from '../../store/AppStore';
import { useScheduledActivation } from '../../hooks/useScheduledActivation';
import {
  useTheme,
  useNavBadges,
  usePushNotifications,
  useArrivalNotifier,
  useNavigation,
} from '../../hooks/useDashboardHooks';
import { ROLES } from '../../domain/permissions';
import { useRoleGuidance } from './useRoleGuidance';
import { useConnectivityUX } from './useConnectivityUX';
import { useDashboardExperience } from './useDashboardExperience';
import type { AppUser } from '../../store/slices/usersSlice';

export function useDashboardRuntime(user: AppUser) {
  const requests = useRequests();
  const blacklist = useBlacklist();
  const { chat, chatLastSeen } = useChat();
  const {
    setAllRequests, setAllMessages, setAllUsers,
    setPerms, setTemplates, setBlacklist,
    markChatSeen, activateScheduled,
    addToBlacklist, removeFromBlacklist,
    updateUser, deleteUser, addUser,
    updateRequest, addRequest, deleteRequest,
  } = useActions();

  const residentDefaultTheme = user.role === ROLES.OWNER || user.role === ROLES.TENANT ? 'light' : 'dark';
  const theme = useTheme(residentDefaultTheme);
  const badges = useNavBadges(user, requests, chat, chatLastSeen, blacklist);
  const { pendingT, pendingP, unreadMsgs, residentNewStatuses, blacklistCount, onPassesSeen } = badges;

  usePushNotifications(user, { pendingT, pendingP, unreadMsgs });
  useArrivalNotifier(user, requests);
  useScheduledActivation(requests, activateScheduled);

  const navigation = useNavigation(user, { markChatSeen, onPassesSeen });
  const { activeTab, goTab } = navigation;

  const connectivity = useConnectivityUX({
    user,
    syncCallbacks: {
      setAllRequests, setAllMessages, setAllUsers, setPerms, setTemplates, setBlacklist,
      addToBlacklist, removeFromBlacklist, updateUser, deleteUser, addUser,
      updateRequest, addRequest, deleteRequest,
    },
  });

  const guidance = useRoleGuidance(user);
  const experience = useDashboardExperience({
    user,
    activeTab,
    badges: { pendingP, pendingT, unreadMsgs, residentNewStatuses, blacklistCount },
    isLoading: connectivity.isLoading,
    isConnErr: connectivity.isConnErr,
    goTab,
  });

  return {
    theme,
    badges,
    navigation,
    connectivity,
    guidance,
    experience,
    pendingCount: pendingT + pendingP,
    isResidentExperience: user.role === ROLES.OWNER || user.role === ROLES.TENANT,
  };
}
