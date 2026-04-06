import React from 'react';
import { AppIcon } from '../../ui/AppIcon';

interface ChatSearchBarProps {
  searchQuery: string;
  onChange: (v: string) => void;
  onClose: () => void;
}

export function ChatSearchBar({ searchQuery, onChange, onClose }: ChatSearchBarProps) {
  return (
    <div className="chat-search-row">
      <span className="chat-search-icon"><AppIcon name="search" size={14} /></span>
      <input
        className="search-inp chat-search-input"
        placeholder="Поиск в чате..."
        autoFocus
        value={searchQuery}
        onChange={e => onChange(e.target.value)}
      />
      <button className="modal-close u-shrink0" onClick={onClose} aria-label="Закрыть поиск">
        <AppIcon name="close" size={14} />
      </button>
    </div>
  );
}
