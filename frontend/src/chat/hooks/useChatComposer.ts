import { useState } from 'react';

export function useChatComposer() {
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<any>(null);
  const [editingMsg, setEditingMsg] = useState<any>(null);
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
