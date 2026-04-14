import { useEffect, useState } from 'react';
import { toast } from '../../ui/Toasts';
import { AppIcon } from '../../ui/AppIcon';
import { STS_LABEL, CAT_LABEL } from '../../constants/index';
import { generatePassQR } from '../../services/qrService';
import { dataUrlToBlob } from '../../utils/dataUrl';
import type { AppRequest } from '../../store/slices/requestsSlice';

type PassReadySheetProps = {
  request: AppRequest | null;
  onClose: () => void;
  onCreateAnother: () => void;
};

function getCategoryLabel(category?: string): string | undefined {
  return category ? CAT_LABEL[category as keyof typeof CAT_LABEL] : undefined;
}

function getPassReadyText(request: AppRequest) {
  const guest = request.visitorName || getCategoryLabel(request.category) || 'Гость';
  const apartment = request.createdByApt ? `Апартаменты ${request.createdByApt}` : 'Резиденции Замоскворечья';
  const car = request.carPlate ? `\nАвто: ${request.carPlate}` : '';
  const schedule = request.scheduledFor
    ? `\nВремя: ${new Date(request.scheduledFor).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}`
    : '';
  return `Пропуск для: ${guest}\n${apartment}${schedule}${car}\nСтатус: ${STS_LABEL[request.status] || 'создан'}\nПокажите QR-код охране на КПП.`;
}

export function PassReadySheet({ request, onClose, onCreateAnother }: PassReadySheetProps) {
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setQrUrl(null);
    setQrError(false);
    if (!request || request.status !== 'approved') return;

    Promise.resolve(generatePassQR(request))
      .then((url) => {
        if (!cancelled) setQrUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [request]);

  if (!request) return null;
  const title = request.scheduledFor ? 'Пропуск запланирован' : 'Пропуск готов';
  const guest = request.visitorName || getCategoryLabel(request.category) || 'Гость';
  const validText = request.scheduledFor
    ? new Date(request.scheduledFor).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
    : 'Охрана увидит его сразу';
  const shareText = getPassReadyText(request);

  const copyPass = async () => {
    try {
      await navigator.clipboard?.writeText(shareText);
      toast('Данные пропуска скопированы', 'success');
    } catch {
      toast('Не удалось скопировать. Проверьте разрешения браузера', 'error');
    }
  };

  const sharePass = async () => {
    const file = qrUrl
      ? new File([dataUrlToBlob(qrUrl)], `pass-${request.id}.png`, { type: 'image/png' })
      : null;

    if (navigator.share) {
      try {
        if (file && navigator.canShare?.({ files: [file] })) {
          await navigator.share({ title, text: shareText, files: [file] });
        } else {
          await navigator.share({ title, text: shareText });
        }
        return;
      } catch {
        return;
      }
    }
    await copyPass();
  };

  return (
    <div className="overlay resident-ready-overlay">
      <div className="resident-ready-sheet" role="dialog" aria-modal="true" aria-labelledby="resident-ready-title">
        <button className="resident-ready-close" onClick={onClose} aria-label="Закрыть">
          <AppIcon name="close" size={14} />
        </button>
        <div className="resident-ready-mark">
          <AppIcon name="check" size={24} />
        </div>
        <div className="resident-ready-kicker">Готово</div>
        <h2 id="resident-ready-title" className="resident-ready-title">{title}</h2>
        <p className="resident-ready-sub">
          {guest}. {validText}. Отправьте гостю QR-код и краткие данные пропуска.
        </p>
        <div className="resident-ready-qr-panel">
          {qrUrl ? (
            <img src={qrUrl} alt="QR-код пропуска для гостя" className="resident-ready-qr" />
          ) : qrError ? (
            <div className="resident-ready-qr-state">QR не удалось сгенерировать. Данные можно отправить текстом.</div>
          ) : request.status === 'approved' ? (
            <div className="resident-ready-qr-state">Генерируем QR...</div>
          ) : (
            <div className="resident-ready-qr-state">QR появится после активации пропуска.</div>
          )}
          <div className="resident-ready-qr-copy">
            <span>Гостю достаточно показать этот QR на КПП</span>
            <strong>{request.createdByApt ? `Апарт. ${request.createdByApt}` : 'Резиденция'}</strong>
          </div>
        </div>
        <div className="resident-ready-summary">
          <div>
            <span>Кому</span>
            <strong>{guest}</strong>
          </div>
          {request.carPlate && (
            <div>
              <span>Авто</span>
              <strong>{request.carPlate}</strong>
            </div>
          )}
          <div>
            <span>Статус</span>
            <strong>{STS_LABEL[request.status] || 'Создан'}</strong>
          </div>
        </div>
        <div className="resident-ready-actions">
          <button className="btn-gold" onClick={sharePass}>
            <span className="u-inline-icon"><AppIcon name="copy" size={14} /> Отправить QR гостю</span>
          </button>
          <button className="btn-outline" onClick={copyPass}>Скопировать данные</button>
          <button className="btn-text" onClick={onCreateAnother}>Создать ещё один</button>
        </div>
      </div>
    </div>
  );
}
