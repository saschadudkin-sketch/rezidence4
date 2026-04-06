import { useCallback } from 'react';
import type React from 'react';
import { genId } from '../../utils';
import { services } from '../../services/providers/serviceContainer';
import apiClient from '../../services/http/apiClient';
import { toast } from '../../ui/Toasts';

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(String(event.target?.result || ''));
    reader.onerror = () => reject(new Error('file_read_failed'));
    reader.readAsDataURL(file);
  });
}

async function compressToJpegBlob(file: File): Promise<Blob> {
  const dataUrl = await readAsDataUrl(file);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const max = 800;
      const ratio = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * ratio);
      canvas.height = Math.round(img.height * ratio);
      canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => resolve(blob || file), 'image/jpeg', 0.72);
    };
    img.onerror = () => resolve(file);
    img.src = dataUrl;
  });
}

export function useChatSend({
  user,
  text,
  setText,
  replyTo,
  setReplyTo,
  inputRef,
  fileRef,
  sendMessage,
  setPhotoSending,
}: {
  user: { uid: string; name: string; role: string };
  text: string;
  setText: (v: string | ((prev: string) => string)) => void;
  replyTo: unknown;
  setReplyTo: (v: unknown) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  fileRef: React.RefObject<HTMLInputElement | null>;
  sendMessage: (msg: unknown) => void;
  setPhotoSending: (v: boolean) => void;
}) {
  const send = useCallback(async () => {
    if (!text.trim()) return;
    const localMessage = {
      id: genId('m'),
      uid: user.uid,
      name: user.name,
      role: user.role,
      text: text.trim(),
      photo: null,
      replyTo: replyTo || null,
      at: new Date(),
    };
    try {
      await services.chat.sendMessage({
        remotePayload: { uid: user.uid, name: user.name, role: user.role, text: text.trim(), replyTo: replyTo || null },
        localMessage,
        sendLocal: sendMessage,
      });
    } finally {
      setText('');
      setReplyTo(null);
      inputRef.current?.focus();
    }
  }, [inputRef, replyTo, sendMessage, setReplyTo, setText, text, user]);

  const onPhotoClick = useCallback(() => {
    fileRef.current?.click();
  }, [fileRef]);

  const insertEmoji = useCallback((emoji: string) => {
    setText((prev) => prev + emoji);
    inputRef.current?.focus();
  }, [inputRef, setText]);

  const onFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    e.target.value = '';
    if (f.size > 10 * 1024 * 1024) {
      toast('Фото слишком большое (макс. 10 МБ)', 'error');
      return;
    }
    setPhotoSending(true);
    try {
      const imageBlob = await compressToJpegBlob(f);
      const uploaded = await apiClient.uploadPhoto(imageBlob);
      if (!uploaded?.url) throw new Error('missing_photo_url');

      const localMessage = {
        id: genId('m'),
        uid: user.uid,
        name: user.name,
        role: user.role,
        text: '',
        photo: uploaded.url,
        at: new Date(),
      };
      await services.chat.sendMessage({
        remotePayload: { uid: user.uid, name: user.name, role: user.role, text: '', photo: uploaded.url },
        localMessage,
        sendLocal: sendMessage,
      });
    } catch {
      toast('Не удалось загрузить фото', 'error');
    } finally {
      setPhotoSending(false);
    }
  }, [sendMessage, setPhotoSending, user]);

  return { send, onPhotoClick, onFileChange, insertEmoji };
}
