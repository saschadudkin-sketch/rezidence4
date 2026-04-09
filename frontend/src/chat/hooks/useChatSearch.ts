import { useEffect, useMemo, useState } from 'react';
import { useDebounce } from '../../hooks/useDebounce';
import { isLiveMode } from '../../config/runtimeMode';
import { toast } from '../../ui/Toasts';
import type { ChatMessage } from '../../store/slices/chatSlice';

type GetMessagesFn = (params?: { search?: string; limit?: number }) => Promise<{ messages: unknown[]; hasMore?: boolean }>;

export function useChatSearch(chat: ChatMessage[], hasMore: boolean, getMessages: GetMessagesFn) {
  const withAutoRetry = async <T,>(fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch {
      return fn();
    }
  };
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [serverSearchResults, setServerSearchResults] = useState<ChatMessage[] | null>(null);
  const [serverSearchLoading, setServerSearchLoading] = useState(false);
  const [serverSearchError, setServerSearchError] = useState('');
  const [searchRetryTick, setSearchRetryTick] = useState(0);
  const debouncedSearchQuery = useDebounce(searchQuery, 400);

  useEffect(() => {
    if (!debouncedSearchQuery.trim() || !hasMore || !isLiveMode()) {
      setServerSearchResults(null);
      setServerSearchError('');
      return;
    }
    let cancelled = false;
    setServerSearchLoading(true);
    setServerSearchError('');
    withAutoRetry(() => getMessages({ search: debouncedSearchQuery.trim(), limit: 60 }))
      .then(data => {
        if (cancelled) return;
        setServerSearchResults((data?.messages ?? []) as ChatMessage[]);
      })
      .catch(() => {
        if (cancelled) return;
        setServerSearchResults(null);
        setServerSearchError('Не удалось выполнить поиск по истории');
        toast('Поиск по истории временно недоступен', 'error');
      })
      .finally(() => { if (!cancelled) setServerSearchLoading(false); });
    return () => { cancelled = true; };
  }, [debouncedSearchQuery, hasMore, searchRetryTick, getMessages]);

  const filteredChat = useMemo(() => {
    if (!searchQuery.trim()) return chat;
    if (serverSearchResults !== null) return serverSearchResults;
    const q = searchQuery.toLowerCase();
    return chat.filter(m => m.text?.toLowerCase().includes(q));
  }, [chat, searchQuery, serverSearchResults]);

  return {
    searchQuery,
    setSearchQuery,
    showSearch,
    setShowSearch,
    serverSearchResults,
    serverSearchLoading,
    serverSearchError,
    searchRetryTick,
    setSearchRetryTick,
    filteredChat,
  };
}
