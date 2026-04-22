/**
 * ConsentModal — ФЗ-152 consent gate.
 *
 * Shown to authenticated residents whose `consent_version` on the server
 * does not match the current policy version.  Blocks the UI until the user
 * accepts.  On accept, POSTs to /api/v1/privacy/consent.
 *
 * We intentionally keep the UI minimal and CSS-module-free here; the modal
 * uses inline styles so it works even before design-system tokens are loaded
 * (the /legal deeplink in the body is styled through a plain link class).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '../services/providers/apiClient';

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
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-modal-title"
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(15, 23, 42, 0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px',
      }}
    >
      <div
        style={{
          maxWidth: 560, width: '100%',
          background: '#fff', borderRadius: 12,
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
          padding: '28px 28px 20px',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
          color: '#0f172a',
        }}
      >
        <h2 id="consent-modal-title" style={{ margin: '0 0 12px', fontSize: 20, fontWeight: 600 }}>
          Согласие на обработку персональных данных
        </h2>
        <p style={{ margin: '0 0 12px', lineHeight: 1.5, fontSize: 14 }}>
          В соответствии с требованиями Федерального закона №152-ФЗ «О персональных данных»
          мы обрабатываем ваши данные (имя, телефон, номер квартиры, фотографии заявок)
          для обеспечения работы сервиса управления жилым комплексом.
        </p>
        <p style={{ margin: '0 0 12px', lineHeight: 1.5, fontSize: 14 }}>
          Вы можете отозвать согласие в любой момент через раздел «Настройки → Конфиденциальность»
          или написав на <a href="mailto:privacy@domhub.su" style={{ color: '#2563eb' }}>privacy@domhub.su</a>.
        </p>
        <p style={{ margin: '0 0 20px', fontSize: 12, color: '#64748b' }}>
          Версия политики: <code>{status.currentVersion}</code>
        </p>
        {error ? (
          <div style={{ color: '#b91c1c', marginBottom: 12, fontSize: 13 }} role="alert">{error}</div>
        ) : null}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <a
            href="/legal/privacy"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: '10px 16px', border: '1px solid #cbd5e1',
              borderRadius: 8, textDecoration: 'none', color: '#0f172a',
              fontSize: 14,
            }}
          >
            Прочитать полностью
          </a>
          <button
            type="button"
            onClick={handleAccept}
            disabled={submitting}
            style={{
              padding: '10px 18px', border: 'none', borderRadius: 8,
              background: submitting ? '#94a3b8' : '#2563eb',
              color: '#fff', fontWeight: 600, fontSize: 14,
              cursor: submitting ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting ? 'Сохраняем…' : 'Принимаю'}
          </button>
        </div>
      </div>
    </div>
  );
}
