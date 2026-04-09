import { useState } from 'react';

export type ChatRefMessage = {
  id: string;
  text?: string;
  name?: string;
  photo?: string | null;
} | null;

export function useChatComposer() {
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<ChatRefMessage>(null);
  const [editingMsg, setEditingMsg] = useState<ChatRefMessage>(null);
  const [showEmoji, setShowEmoji] = useState(false);

  const resetComposer = () => {
    setText('');
    setReplyTo(null);
    setEditingMsg(null);
    setShowEmoji(false);
  };

  return {
    text,
    setText,
    replyTo,
    setReplyTo,
    editingMsg,
    setEditingMsg,
    showEmoji,
    setShowEmoji,
    resetComposer,
  };
}
