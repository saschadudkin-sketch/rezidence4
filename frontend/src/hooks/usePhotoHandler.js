import { useState } from 'react';
import { MAX_PHOTOS_PER_REQUEST, MAX_FILE_SIZE_BYTES, PHOTO_MAX_WIDTH_PX, PHOTO_JPEG_QUALITY } from '../constants/limits';
import { toast } from '../ui/Toasts';
import { getCachedCompressed, cacheCompressed } from '../store/persistence/photoCache';

// SEC-02: magic-byte MIME validation — we read the first 12 bytes of the file and
// compare them to known image signatures instead of trusting file.type, which can
// be spoofed by renaming a non-image file to .jpg.
const IMAGE_SIGNATURES = [
  { mime: 'image/jpeg', bytes: [0xFF, 0xD8, 0xFF] },
  { mime: 'image/png',  bytes: [0x89, 0x50, 0x4E, 0x47] },
  { mime: 'image/gif',  bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46] }, // "RIFF" — WEBP follows at offset 8
  { mime: 'image/avif', bytes: [0x00, 0x00, 0x00] },       // ftyp box — partial match, see check below
];

/**
 * Returns true if the file's magic bytes match a known safe image format.
 * Reads only the first 12 bytes (negligible cost).
 */
function validateImageMagicBytes(file) {
  return new Promise((resolve) => {
    const slice = file.slice(0, 12);
    const reader = new FileReader();
    reader.onload = (e) => {
      const arr = new Uint8Array(e.target.result);
      const matches = IMAGE_SIGNATURES.some(({ bytes }) =>
        bytes.every((b, i) => arr[i] === b)
      );
      // AVIF: bytes 4-7 are "ftyp" — wider check for container formats
      const isFtyp = arr[4] === 0x66 && arr[5] === 0x74 && arr[6] === 0x79 && arr[7] === 0x70;
      resolve(matches || isFtyp);
    };
    reader.onerror = () => resolve(false);
    reader.readAsArrayBuffer(slice);
  });
}

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
 * PERF-02: Compress image with IndexedDB caching.
 * On repeated selection of the same file (same name+size+lastModified),
 * returns the cached compressed data URL without re-running canvas compression.
 */
async function compressImageCached(file, dataUrl) {
  const fingerprint = `${file.name}|${file.size}|${file.lastModified}`;
  const cached = await getCachedCompressed(fingerprint);
  if (cached) return cached;
  const compressed = await compressImage(dataUrl);
  // store in cache (fire-and-forget, don't block on storage)
  cacheCompressed(fingerprint, compressed).catch(() => {});
  return compressed;
}

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

    // SEC-02: validate magic bytes before reading full files — rejects renamed non-images
    const magicChecks = await Promise.all(toProcess.map(validateImageMagicBytes));
    const invalidIdx = magicChecks.findIndex(ok => !ok);
    if (invalidIdx !== -1) {
      toast(`Файл «${toProcess[invalidIdx].name}» не является изображением`, 'error');
      e.target.value = '';
      return;
    }

    try {
      const results = await Promise.all(
        toProcess.map(f => new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = async (ev) => {
            try { resolve(await compressImageCached(f, ev.target.result)); }
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
