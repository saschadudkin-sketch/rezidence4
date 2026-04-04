import { useState } from 'react';
import { MAX_PHOTOS_PER_REQUEST, MAX_FILE_SIZE_BYTES, PHOTO_MAX_WIDTH_PX, PHOTO_JPEG_QUALITY } from '../constants/limits';
import { toast } from '../ui/Toasts';

/**
 * compressImage — сжимает dataURL до maxWidth при качестве quality.
 * Graceful degradation: при сбое canvas context возвращает оригинал.
 * A-03: extracted from useCreateRequest.js.
 */
export const compressImage = (dataUrl, maxWidth = PHOTO_MAX_WIDTH_PX, quality = PHOTO_JPEG_QUALITY) =>
  new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scale  = Math.min(1, maxWidth / img.width);
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      // FIX: getContext('2d') может вернуть null в Safari при превышении лимита
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(dataUrl); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });

/**
 * usePhotoHandler — manages photo list state for the create-request form.
 * Handles file reading, compression, size/count limits.
 * A-03: extracted from useCreateRequest.js.
 *
 * @param {React.RefObject<boolean>} isMountedRef
 */
export function usePhotoHandler(isMountedRef) {
  const [photos, setPhotos] = useState([]);

  const handlePhoto = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const remaining = MAX_PHOTOS_PER_REQUEST - photos.length;
    if (remaining <= 0) { toast(`Максимум ${MAX_PHOTOS_PER_REQUEST} фото`, 'error'); return; }
    const toProcess = files.slice(0, remaining);
    if (files.length > remaining) toast(`Добавлено ${remaining} из ${files.length} фото (макс. ${MAX_PHOTOS_PER_REQUEST})`, 'info');

    const oversized = toProcess.some(f => f.size > MAX_FILE_SIZE_BYTES);
    if (oversized) { toast('Фото слишком большое (макс. 10 МБ)', 'error'); return; }

    try {
      const results = await Promise.all(
        toProcess.map(f => new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = async (ev) => {
            try { resolve(await compressImage(ev.target.result)); }
            catch (err) { reject(err); }
          };
          reader.onerror = () => reject(new Error('Не удалось загрузить фото'));
          reader.readAsDataURL(f);
        }))
      );
      // FIX [LEAK]: модал может закрыться пока файлы читались (медленный диск)
      if (isMountedRef.current) setPhotos(prev => [...prev, ...results].slice(0, MAX_PHOTOS_PER_REQUEST));
    } catch {
      if (isMountedRef.current) toast('Не удалось загрузить фото', 'error');
    }
    e.target.value = '';
  };

  const removePhoto = (idx) => setPhotos(prev => prev.filter((_, i) => i !== idx));

  return { photos, setPhotos, handlePhoto, removePhoto };
}
