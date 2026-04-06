import React from 'react';
import StateBlock from '../ui/StateBlock';
import { AppIcon } from '../ui/AppIcon';

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
            <StateBlock type="loading" title="Загрузка истории…" />
          ) : (
            <button
              onClick={onLoadOlder}
              className="btn-outline u-block u-mx-auto u-minw160"
            >
              <span className="u-inline-icon"><AppIcon name="history" size={14} /> Загрузить ещё</span>
            </button>
          )}
          {historyError && (
            <StateBlock
              type="error"
              title="История чата недоступна"
              subtitle={historyError}
              actionLabel="Повторить"
              onAction={onLoadOlder}
            />
          )}
        </div>
      )}
      {serverSearchLoading && (
        <StateBlock type="loading" title="Поиск по всей истории…" />
      )}
      {serverSearchError && !serverSearchLoading && (
        <StateBlock
          type="error"
          title="Не удалось выполнить поиск"
          subtitle={serverSearchError}
          actionLabel="Повторить"
          onAction={onRetryServerSearch}
        />
      )}
      {initialHistoryError && !hasMore && (
        <StateBlock
          type="error"
          title="История чата временно недоступна"
          subtitle={initialHistoryError}
          actionLabel="Повторить"
          onAction={onRetryInitialSync}
        />
      )}
      {filteredChatLength === 0 && !serverSearchLoading && (
        <StateBlock
          type="empty"
          title={searchQuery ? 'Ничего не найдено' : 'Начните переписку'}
          subtitle={searchQuery ? 'Попробуйте изменить запрос' : 'Напишите первое сообщение в этом чате'}
        />
      )}
      {renderMessages()}
      <div ref={bottomRef}/>
    </div>
  );
}
