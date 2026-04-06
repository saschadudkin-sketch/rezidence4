import React from 'react';
import { AppIcon } from '../../ui/AppIcon';

interface ChatComposerBarProps {
  showSearch: boolean;
  showEmoji: boolean;
  photoSending: boolean;
  text: string;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onToggleSearch: () => void;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onPhotoClick: () => void;
  onToggleEmoji: () => void;
  onTextChange: (v: string) => void;
  onSend: () => void;
}

export function ChatComposerBar({
  showSearch,
  showEmoji,
  photoSending,
  text,
  inputRef,
  fileRef,
  onToggleSearch,
  onFileChange,
  onPhotoClick,
  onToggleEmoji,
  onTextChange,
  onSend,
}: ChatComposerBarProps) {
  return (
    <div className="chat-bar">
      <button className={'chat-photo-btn ' + (showSearch ? 'chat-btn--active' : 'chat-btn--default')} title="Поиск" onClick={onToggleSearch}>
        <AppIcon name="search" size={16} />
      </button>
      <input ref={fileRef} type="file" accept="image/*" className="hidden-input" onChange={onFileChange} />
      <button className="chat-photo-btn" onClick={onPhotoClick} disabled={photoSending} aria-label="Прикрепить фото">
        {photoSending ? <AppIcon name="history" size={16} /> : <AppIcon name="file" size={16} />}
      </button>
      <button className={'chat-photo-btn ' + (showEmoji ? 'chat-btn--active' : 'chat-btn--default')} onClick={onToggleEmoji} aria-label="Emoji">
        <AppIcon name="chat" size={16} />
      </button>
      <textarea
        ref={inputRef}
        className="chat-inp"
        rows={1}
        placeholder="Напишите сообщение..."
        value={text}
        onChange={e => onTextChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); } }}
      />
      <button className="chat-send" onClick={onSend} disabled={!text.trim()} aria-label="Отправить сообщение">
        <AppIcon name="chevronRight" size={14} />
      </button>
    </div>
  );
}
