import { useCallback, useEffect, useState, type RefObject } from 'react';
import { services } from '../../services/providers/serviceContainer';
import { isLiveMode } from '../../config/runtimeMode';
import { toast } from '../../ui/Toasts';
import type { ChatMessage } from '../../store/slices/chatSlice';

interface UseChatDataArgs {
  chat: ChatMessage[];
  setAllMessages: (messages: ChatMessage[]) => void;
  msgsContainerRef: RefObject<HTMLDivElement | null>;
}

export function useChatData({ chat, setAllMessages, msgsContainerRef }: UseChatDataArgs) {
  const withAutoRetry = async <T,>(fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch {
      return fn();
    }
  };
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [initialHistoryError, setInitialHistoryError] = useState('');

  const syncHasMoreMeta = useCallback(async () => {
    if (!isLiveMode()) return;
    setInitialHistoryError('');
    const data = await withAutoRetry(() => services.chat.getMessages({ limit: 60 }));
    setHasMore(data?.hasMore ?? false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    syncHasMoreMeta().catch(() => {
      if (cancelled) return;
      setInitialHistoryError('Не удалось загрузить состояние истории чата');
      toast('Ошибка синхронизации истории чата', 'error');
    });
    return () => {
      cancelled = true;
    };
  }, [syncHasMoreMeta]);

  const loadOlderMessages = useCallback(async () => {
    if (loadingOlder || !hasMore || !isLiveMode()) return;
    const oldestMsg = chat[0];
    if (!oldestMsg) return;

    setLoadingOlder(true);
    setHistoryError('');
    const container = msgsContainerRef.current;
    const prevScrollHeight = container?.scrollHeight ?? 0;

    try {
      const data = await withAutoRetry(() => services.chat.getMessages({ before: oldestMsg.id, limit: 60 }));
      if (data?.messages?.length) {
        setAllMessages([...data.messages, ...chat]);
        setHasMore(data.hasMore ?? false);
        requestAnimationFrame(() => {
          if (container) {
            container.scrollTop = container.scrollHeight - prevScrollHeight;
          }
        });
      } else {
        setHasMore(false);
      }
    } catch {
      setHistoryError('Не удалось загрузить более ранние сообщения');
      toast('Ошибка загрузки истории чата', 'error');
    } finally {
      setLoadingOlder(false);
    }
  }, [chat, hasMore, loadingOlder, msgsContainerRef, setAllMessages]);

  const retryInitialSync = useCallback(() => {
    syncHasMoreMeta().catch(() => {
      setInitialHistoryError('Не удалось загрузить состояние истории чата');
      toast('Ошибка синхронизации истории чата', 'error');
    });
  }, [syncHasMoreMeta]);

  return {
    hasMore,
    loadingOlder,
    historyError,
    initialHistoryError,
    loadOlderMessages,
    retryInitialSync,
  };
}
