import { useState } from 'react';
import type { MutableRefObject } from 'react';
import { MAX_PHOTOS_PER_REQUEST, MAX_FILE_SIZE_BYTES, PHOTO_MAX_WIDTH_PX, PHOTO_JPEG_QUALITY } from '../constants/limits';
import { toast } from '../ui/Toasts';
import { getCachedCompressed, cacheCompressed } from '../store/persistence/photoCache';

const IMAGE_SIGNATURES = [
  { mime: 'image/jpeg', bytes: [0xFF, 0xD8, 0xFF] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4E, 0x47] },
  { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46] },
  { mime: 'image/avif', bytes: [0x00, 0x00, 0x00] },
] as const;

function validateImageMagicBytes(file: File): Promise<boolean> {
  return new Promise((resolve) => {
    const slice = file.slice(0, 12);
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result;
      if (!(result instanceof ArrayBuffer)) {
        resolve(false);
        return;
      }
      const bytes = new Uint8Array(result);
      const matches = IMAGE_SIGNATURES.some(({ bytes: signature }) =>
        signature.every((byte, index) => bytes[index] === byte),
      );
      const isFtyp = bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
      resolve(matches || isFtyp);
    };
    reader.onerror = () => resolve(false);
    reader.readAsArrayBuffer(slice);
  });
}

export const compressImage = (
  dataUrl: string,
  maxWidth: number = PHOTO_MAX_WIDTH_PX,
  quality: number = PHOTO_JPEG_QUALITY,
): Promise<string> =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, maxWidth / img.width);
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });

async function compressImageCached(file: File, dataUrl: string): Promise<string> {
  const fingerprint = `${file.name}|${file.size}|${file.lastModified}`;
  const cached = await getCachedCompressed(fingerprint);
  if (cached) return cached;
  const compressed = await compressImage(dataUrl);
  cacheCompressed(fingerprint, compressed).catch(() => {});
  return compressed;
}

export function usePhotoHandler(isMountedRef: MutableRefObject<boolean>) {
  const [photos, setPhotos] = useState<string[]>([]);

  const handlePhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    const remaining = MAX_PHOTOS_PER_REQUEST - photos.length;
    if (remaining <= 0) {
      toast(`Максимум ${MAX_PHOTOS_PER_REQUEST} фото`, 'error');
      return;
    }
    const toProcess = files.slice(0, remaining);
    if (files.length > remaining) {
      toast(`Добавлено ${remaining} из ${files.length} фото (макс. ${MAX_PHOTOS_PER_REQUEST})`, 'info');
    }

    if (toProcess.some((file) => file.size > MAX_FILE_SIZE_BYTES)) {
      toast('Фото слишком большое (макс. 10 МБ)', 'error');
      return;
    }

    const magicChecks = await Promise.all(toProcess.map(validateImageMagicBytes));
    const invalidIndex = magicChecks.findIndex((ok) => !ok);
    if (invalidIndex !== -1) {
      toast(`Файл «${toProcess[invalidIndex].name}» не является изображением`, 'error');
      event.target.value = '';
      return;
    }

    try {
      const results = await Promise.all(
        toProcess.map(
          (file) =>
            new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = async (loadEvent) => {
                const result = loadEvent.target?.result;
                if (typeof result !== 'string') {
                  reject(new Error('Не удалось загрузить фото'));
                  return;
                }
                try {
                  resolve(await compressImageCached(file, result));
                } catch (error) {
                  reject(error);
                }
              };
              reader.onerror = () => reject(new Error('Не удалось загрузить фото'));
              reader.readAsDataURL(file);
            }),
        ),
      );

      if (isMountedRef.current) {
        setPhotos((prev) => [...prev, ...results].slice(0, MAX_PHOTOS_PER_REQUEST));
      }
    } catch {
      if (isMountedRef.current) toast('Не удалось загрузить фото', 'error');
    }
    event.target.value = '';
  };

  const removePhoto = (index: number) => {
    setPhotos((prev) => prev.filter((_, currentIndex) => currentIndex !== index));
  };

  return { photos, setPhotos, handlePhoto, removePhoto };
}
