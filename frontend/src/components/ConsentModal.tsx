/**
 * ConsentModal — ФЗ-152 consent gate.
 *
 * Shown to authenticated residents whose `consent_version` on the server
 * does not match the current policy version.  Blocks the UI until the user
 * accepts.  On accept, POSTs to /api/v1/privacy/consent.
 *
 * The modal uses the shared modal accessibility helper because it blocks the
 * first authenticated UI until the resident accepts the current policy.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '../services/providers/apiClient';
import { useModalAccessibility } from '../ui/useModalAccessibility';
import { lockScroll, unlockScroll } from '../ui/scrollLock';

type ConsentStatus = {
  currentVersion: string;
  acceptedVersion: string | null;
  acceptedAt: string | null;
  needsAcceptance: boolean;
};

type Props = {
  /** True when the user is authenticated — we only fetch consent after login. */
  enabled: boolean;
};

export default function ConsentModal({ enabled }: Props) {
  const [status, setStatus] = useState<ConsentStatus | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Avoid fetching the status twice in StrictMode dev double-mount.
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!enabled || fetchedRef.current) return;
    fetchedRef.current = true;
    let cancelled = false;
    apiClient
      .get('/api/v1/privacy/consent')
      .then((res) => {
        if (!cancelled) setStatus(res as ConsentStatus);
      })
      .catch(() => {
        // 404 (user gone) or 401 (not yet auth'd) — just skip; re-try on next mount.
        if (!cancelled) fetchedRef.current = false;
      });
    return () => { cancelled = true; };
  }, [enabled]);

  const handleAccept = useCallback(async () => {
    if (!status) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.post('/api/v1/privacy/consent', { version: status.currentVersion });
      setStatus({ ...status, acceptedVersion: status.currentVersion, acceptedAt: new Date().toISOString(), needsAcceptance: false });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Не удалось сохранить согласие';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }, [status]);

  if (!enabled || !status || !status.needsAcceptance) return null;

  return (
    <ConsentDialog
      status={status}
      submitting={submitting}
      error={error}
      onAccept={handleAccept}
    />
  );
}

function ConsentDialog({
  status,
  submitting,
  error,
  onAccept,
}: {
  status: ConsentStatus;
  submitting: boolean;
  error: string | null;
  onAccept: () => void;
}) {
  const { dialogRef, overlayProps } = useModalAccessibility({
    onClose: () => {},
    closeOnEsc: false,
  });

  useEffect(() => {
    lockScroll();
    return () => {
      unlockScroll();
    };
  }, []);

  return (
    <div className="overlay consent-overlay" {...overlayProps}>
      <div
        className="modal modal--confirm consent-modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="consent-modal-title"
        tabIndex={-1}
      >
        <div className="modal-head">
          <div className="modal-head-main">
            <h2 id="consent-modal-title" className="modal-title">Согласие на обработку персональных данных</h2>
            <span className="modal-subtitle">Обязательное подтверждение для продолжения работы.</span>
          </div>
        </div>
        <div className="modal-body consent-modal__body">
          <p>
            В соответствии с требованиями Федерального закона №152-ФЗ «О персональных данных»
            мы обрабатываем ваши данные (имя, телефон, номер квартиры, фотографии заявок)
            для обеспечения работы сервиса управления жилым комплексом.
          </p>
          <p>
            Вы можете отозвать согласие в любой момент через раздел «Настройки → Конфиденциальность»
            или написав на <a href="mailto:privacy@domhub.su">privacy@domhub.su</a>.
          </p>
          <p className="consent-modal__version">
            Версия политики: <code>{status.currentVersion}</code>
          </p>
        </div>
        {error ? (
          <div className="consent-modal__error" role="alert" aria-live="assertive">{error}</div>
        ) : null}
        <div className="modal-foot">
          <a
            href="/legal/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-outline"
          >
            Прочитать полностью
          </a>
          <button
            type="button"
            className="btn-gold"
            onClick={onAccept}
            disabled={submitting}
          >
            {submitting ? 'Сохраняем…' : 'Принимаю'}
          </button>
        </div>
      </div>
    </div>
  );
}
