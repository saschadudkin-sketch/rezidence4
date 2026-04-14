/**
 * compressImage.js — CQ-02: единая утилита сжатия изображений.
 * Устраняет дублирование canvas-логики в useCreateRequest, Modals и ChatView.
 *
 * @param {File|string} input   — File-объект или dataURL
 * @param {object}      options
 * @param {number}      options.maxWidth  — максимальная ширина (px), default 1024
 * @param {number}      options.quality   — качество JPEG (0–1), default 0.72
 * @returns {Promise<File|string>}        — сжатый File (из File) или dataURL (из dataURL)
 */
export function compressImage(
  input: File | string,
  { maxWidth = 1024, quality = 0.72 }: { maxWidth?: number; quality?: number } = {},
): Promise<File | string> {
  return new Promise<File | string>((resolve) => {
    const isFile = input instanceof File;
    const src = isFile ? URL.createObjectURL(input) : input;

    const img = new Image();
    img.onload = () => {
      if (isFile) URL.revokeObjectURL(src);

      const canvas = document.createElement('canvas');
      const scale  = Math.min(1, maxWidth / img.width);
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);

      // FIX [CQ-02]: getContext('2d') может вернуть null в Safari при превышении лимита
      // canvas-контекстов. Graceful degradation — возвращаем оригинал без сжатия.
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(input); return; }

      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      if (isFile) {
        canvas.toBlob(
          blob => resolve(blob ? new File([blob], input.name, { type: 'image/jpeg' }) : input),
          'image/jpeg',
          quality,
        );
      } else {
        resolve(canvas.toDataURL('image/jpeg', quality));
      }
    };
    img.onerror = () => resolve(input);
    img.src = src;
  });
}
