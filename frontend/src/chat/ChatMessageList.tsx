import React from 'react';
import ViewStateAdapter from '../ui/ViewStateAdapter';
import { AppIcon } from '../ui/AppIcon';
import ErrorRecoveryPanel from '../ui/ErrorRecoveryPanel';

interface ChatMessageListProps {
  msgsContainerRef: React.RefObject<HTMLDivElement | null>;
  hasMore: boolean;
  loadingOlder: boolean;
  historyError: string;
  onLoadOlder: () => void;
  serverSearchLoading: boolean;
  serverSearchError: string;
  onRetryServerSearch: () => void;
  initialHistoryError: string;
  onRetryInitialSync: () => void;
  filteredChatLength: number;
  searchQuery: string;
  renderMessages: () => React.ReactNode;
  bottomRef: React.RefObject<HTMLDivElement | null>;
}

export function ChatMessageList({
  msgsContainerRef,
  hasMore,
  loadingOlder,
  historyError,
  onLoadOlder,
  serverSearchLoading,
  serverSearchError,
  onRetryServerSearch,
  initialHistoryError,
  onRetryInitialSync,
  filteredChatLength,
  searchQuery,
  renderMessages,
  bottomRef,
}: ChatMessageListProps) {
  return (
    <div className="chat-msgs" ref={msgsContainerRef}>
      {hasMore && (
        <div className="u-py8">
          {loadingOlder ? (
            <ViewStateAdapter entity="history" state="loading" title="Загрузка истории…" subtitle="Пожалуйста, подождите" />
          ) : (
            <button
              onClick={onLoadOlder}
              className="btn-outline u-block u-mx-auto u-minw160"
            >
              <span className="u-inline-icon"><AppIcon name="chevron-up" size={14} /> Загрузить ещё</span>
            </button>
          )}
          {historyError && (
            <ViewStateAdapter
              entity="history"
              state="error"
              title="История чата недоступна"
              subtitle={historyError}
              actionLabel="Повторить"
              onAction={onLoadOlder}
            />
          )}
        </div>
      )}
      {serverSearchLoading && (
        <ViewStateAdapter entity="history" state="loading" title="Поиск по всей истории…" subtitle="Пожалуйста, подождите" />
      )}
      {serverSearchError && !serverSearchLoading && (
        <>
          <ViewStateAdapter
            entity="history"
            state="error"
            title="Не удалось выполнить поиск"
            subtitle={serverSearchError}
            actionLabel="Повторить"
            onAction={onRetryServerSearch}
          />
          <ErrorRecoveryPanel
            message="Поиск по облачной истории недоступен"
            onRetry={onRetryServerSearch}
            onFallback={() => { window.location.assign('/dashboard/passes?offlineQueue=1'); }}
          />
        </>
      )}
      {initialHistoryError && !hasMore && (
        <ViewStateAdapter
          entity="history"
          state="error"
          title="История чата временно недоступна"
          subtitle={initialHistoryError}
          actionLabel="Повторить"
          onAction={onRetryInitialSync}
        />
      )}
      {filteredChatLength === 0 && !serverSearchLoading && (
        <ViewStateAdapter
          entity="history"
          state="empty"
          title={searchQuery ? 'Ничего не найдено' : 'Начните переписку'}
          subtitle={searchQuery ? 'Попробуйте изменить запрос' : 'Напишите первое сообщение в этом чате'}
        />
      )}
      {renderMessages()}
      <div ref={bottomRef}/>
    </div>
  );
}
