import { useEffect } from 'react';
import type { MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { AppIcon } from './AppIcon';

type PhotoLightboxProps = {
  src: string;
  onClose: () => void;
};

export function PhotoLightbox({ src, onClose }: PhotoLightboxProps) {
  useEffect(() => {
    const fn = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', fn);
    return () => document.removeEventListener('keydown', fn);
  }, [onClose]);

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,.92)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <img
        src={src}
        alt="фото"
        style={{ maxWidth: '94vw', maxHeight: '88vh', objectFit: 'contain', borderRadius: 6 }}
        onClick={(event: MouseEvent<HTMLImageElement>) => event.stopPropagation()}
      />
      <button
        onClick={onClose}
        style={{
          position: 'absolute', top: 16, right: 16,
          background: 'rgba(0,0,0,.5)', border: 'none', color: '#fff',
          width: 36, height: 36, borderRadius: '50%', fontSize: 18, cursor: 'pointer',
        }}
        aria-label="Закрыть"
      ><AppIcon name="close" size={16} /></button>
    </div>,
    document.body
  );
}
