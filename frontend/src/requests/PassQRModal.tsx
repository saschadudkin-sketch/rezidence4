import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { generatePassQR } from '../services/qrService';
import { CAT_LABEL, PASS_DURATION_LABEL, PASS_DURATION_ICON } from '../constants/index';
import { lockScroll, unlockScroll } from '../ui/scrollLock';
import { toast } from '../ui/Toasts';
import { AppIcon } from '../ui/AppIcon';
import { useModalAccessibility } from '../ui/useModalAccessibility';

/**
 * PassQRModal — показывает QR-код пропуска для предъявления охране.
 * Жилец открывает → показывает на телефоне охраннику → охранник сканирует.
 */
// FIX [DRY]: вынесен общий хелпер — ранее дублировался в copy + save обработчиках
function dataUrlToBlob(dataUrl) {
  const arr  = dataUrl.split(',');
  const mime = (arr[0].match(/:(.*?);/) || [])[1] || 'image/png';
  const bstr = atob(arr[1]);
  const u8   = new Uint8Array(bstr.length);
  for (let i = 0; i < bstr.length; i++) u8[i] = bstr.charCodeAt(i);
  return new Blob([u8], { type: mime });
}

export function PassQRModal({ req, onClose }) {
  const [qrUrl, setQrUrl] = useState(null);
  const [error, setError]  = useState(false);

  const { dialogRef, overlayProps } = useModalAccessibility({ onClose });

  useEffect(() => {
    lockScroll();
    return () => { unlockScroll(); };
  }, []);

  useEffect(() => {
    Promise.resolve(generatePassQR(req))
      .then(setQrUrl)
      .catch(() => setError(true));
  // FIX [PERF]: зависим только от req.id — QR меняется только при смене заявки,
  // не при каждом обновлении объекта req от родителя.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req.id]);

  return createPortal(
    <div className="overlay" {...overlayProps}>
      <div className="modal" ref={dialogRef} role="dialog" aria-modal="true" tabIndex={-1}>
        <div className="modal-handle" />
        <div className="modal-head">
          <div>
            <span className="modal-title">QR-код пропуска</span>
            <div className="u-fs11 u-t4 u-mt2">
              Покажите охране для быстрого прохода
            </div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Закрыть"><AppIcon name="close" size={14} /></button>
        </div>
        <div className="modal-body u-center">
          {error && (
            <div className="u-err u-fs13 u-center qr-error-box">
              Не удалось сгенерировать QR-код
            </div>
          )}
          {!error && !qrUrl && (
            <div className="qr-loading">
              <span className="u-t4 u-fs13">Генерация...</span>
            </div>
          )}
          {qrUrl && (
            <div className="qr-container">
              <img src={qrUrl} alt="QR-код пропуска" className="qr-img" />
            </div>
          )}
          <div className="qr-info">
            <div className="qr-info-row">
              <span className="qr-info-lbl">Тип</span>
              <span className="qr-info-val">{CAT_LABEL[req.category] || req.category}</span>
            </div>
            {req.visitorName && (
              <div className="qr-info-row">
                <span className="qr-info-lbl">Посетитель</span>
                <span className="qr-info-val">{req.visitorName}</span>
              </div>
            )}
            {req.carPlate && (
              <div className="qr-info-row">
                <span className="qr-info-lbl">Авто</span>
                <span className="qr-info-val">{req.carPlate}</span>
              </div>
            )}
            <div className="qr-info-row">
              <span className="qr-info-lbl">Квартира</span>
              <span className="qr-info-val">Апарт. {req.createdByApt}</span>
            </div>
            <div className="qr-info-row">
              <span className="qr-info-lbl">Заказчик</span>
              <span className="qr-info-val">{req.createdByName}</span>
            </div>
            {req.passDuration && (
              <div className="qr-info-row">
                <span className="qr-info-lbl">Тип пропуска</span>
                <span className="qr-info-val"><AppIcon name={PASS_DURATION_ICON[req.passDuration] || 'ticket'} className="u-inline-icon" /> {PASS_DURATION_LABEL[req.passDuration]}</span>
              </div>
            )}
            {req.validUntil && (
              <div className="qr-info-row">
                <span className="qr-info-lbl">Действует до</span>
                <span className="qr-info-val">{new Date(req.validUntil).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
              </div>
            )}
          </div>
        </div>
        <div className="modal-foot pass-qr-foot">
          {qrUrl && (
            <div className="u-flex u-gap8 u-w-full">
              <button className="btn-outline u-flex1" onClick={async () => {
                try {
                  const blob = dataUrlToBlob(qrUrl);
                  await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
                  toast('QR скопирован в буфер', 'success');
                } catch {
                  toast('Не удалось скопировать', 'error');
                }
              }}><span className="u-inline-icon"><AppIcon name="list" size={14} /> Копировать</span></button>
              <button className="btn-outline u-flex1" onClick={() => {
                try {
                  const blob = dataUrlToBlob(qrUrl);
                  const url  = URL.createObjectURL(blob);
                  const a    = document.createElement('a');
                  a.href = url; a.download = 'pass-qr.png';
                  document.body.appendChild(a); a.click(); document.body.removeChild(a);
                  setTimeout(() => URL.revokeObjectURL(url), 100);
                  toast('QR сохранён', 'success');
                } catch {
                  toast('Не удалось скачать', 'error');
                }
              }}><span className="u-inline-icon"><AppIcon name="file" size={14} /> Скачать</span></button>
            </div>
          )}
          <button className="btn-gold u-w-full" onClick={onClose}><span>Закрыть</span></button>
        </div>
      </div>
    </div>,
    document.body
  );
}
