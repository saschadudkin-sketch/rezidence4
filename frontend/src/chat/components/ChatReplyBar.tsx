import React from 'react';
import { AppIcon } from '../../ui/AppIcon';

interface ChatReplyBarProps {
  replyTo: { name?: string; text?: string; photo?: string | null };
  onClose: () => void;
}

export function ChatReplyBar({ replyTo, onClose }: ChatReplyBarProps) {
  return (
    <div className="chat-reply-bar">
      <div className="chat-reply-bar-line" />
      <div className="chat-reply-bar-body">
        <div className="chat-reply-bar-name">{replyTo.name}</div>
        <div className="chat-reply-bar-text">{replyTo.photo ? 'Фото' : replyTo.text}</div>
      </div>
      <button className="chat-reply-close" onClick={onClose} aria-label="Отменить ответ">
        <AppIcon name="close" size={14} />
      </button>
    </div>
  );
}
