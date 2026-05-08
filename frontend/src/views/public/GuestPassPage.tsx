/**
 * GuestPassPage — public, unauthenticated share page for a guest pass.
 *
 * URL: /p/:token  (domhub.su/p/<64-hex-token>)
 *
 * The resident creates a pass, DomHub mints a `qr_passes` row with a random
 * 32-byte token, and the resident shares https://domhub.su/p/<token> (or the
 * QR that encodes that URL).  When the guest opens the link:
 *   1. We call GET /api/v1/public/pass/:token (no auth, rate-limited 30/min/IP)
 *    — see backend/src/routes/publicPass.js.  The response intentionally
 *      omits the resident UID, phone, and other PII.
 *   2. We render the card from docs/design-reference/guest-pass-card.html
 *      with the visitor's name, apartment, validity window, and a QR
 *      containing the same URL so the guard can scan it at the gate.
 *
 * Intentional design choices:
 *   — Plain `fetch`, NOT apiClient.  The public endpoint is unauthenticated;
 *     routing through the auth-aware client would attach refresh tokens and
 *     trigger 401/refresh noise on a page that has no session.
 *   — Dark tokens re-declared locally (see GuestPassPage.module.css `.root`)
 *     so the premium dark look is pinned regardless of the app theme.
 *   — PDF via `window.print()` + a print stylesheet.  The reference HTML
 *     labels the ghost button "Сохранить как PDF"; the browser's print
 *     dialog lets the guest save-as-PDF without bundling jsPDF.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import styles from './GuestPassPage.module.css';

type PassStatus = 'valid' | 'used' | 'expired' | 'invalid';

type PublicPass = {
  status: PassStatus;
  visitorName: string | null;
  propertyName: string | null;
  apartment: string | null;
  validUntil: string | null;
  type: string;
  passId: string;
};

type FetchState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; pass: PublicPass; qrDataUrl: string | null };

const TOKEN_RE = /^[0-9a-f]{64}$/i;

function formatValidUntil(iso: string | null): { date: string; time: string } | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const date = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  const time = `до ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
  return { date, time };
}

function statusLabel(status: PassStatus): string {
  switch (status) {
    case 'valid': return 'Действителен';
    case 'used': return 'Уже использован';
    case 'expired': return 'Срок истёк';
    case 'invalid': return 'Недействителен';
  }
}

function typeLabel(type: string): string {
  switch (type) {
    case 'pass': return 'Гостевой';
    case 'visit': return 'Гостевой';
    case 'delivery': return 'Доставка';
    case 'taxi': return 'Такси';
    case 'service': return 'Сервис';
    default: return 'Разовый';
  }
}

export default function GuestPassPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<FetchState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token || !TOKEN_RE.test(token)) {
        setState({ kind: 'error', message: 'Некорректная ссылка пропуска.' });
        return;
      }
      try {
        const res = await fetch(`/api/v1/public/pass/${token}`, {
          headers: { Accept: 'application/json' },
          credentials: 'omit',
        });
        if (!res.ok) {
          const msg = res.status === 404
            ? 'Пропуск не найден. Возможно, ссылка устарела.'
            : res.status === 429
              ? 'Слишком много запросов. Попробуйте обновить страницу через минуту.'
              : 'Не удалось загрузить пропуск.';
          if (!cancelled) setState({ kind: 'error', message: msg });
          return;
        }
        const pass = (await res.json()) as PublicPass;

        // Render the QR from the canonical share URL so the guard's scanner
        // just opens the same page on their device — no custom payload parse.
        let qrDataUrl: string | null = null;
        try {
          const QRCode = (await import('qrcode')).default;
          const url = `${window.location.origin}/p/${token}`;
          qrDataUrl = await QRCode.toDataURL(url, {
            width: 400,
            margin: 1,
            errorCorrectionLevel: 'M',
            color: { dark: '#0f172a', light: '#ffffff' },
          });
        } catch {
          qrDataUrl = null; // fall back to placeholder text
        }

        if (!cancelled) setState({ kind: 'ready', pass, qrDataUrl });
      } catch {
        if (!cancelled) {
          setState({ kind: 'error', message: 'Нет связи с сервером. Проверьте интернет и обновите страницу.' });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const onPrint = useCallback(() => {
    // Browsers expose "Save as PDF" inside the print dialog on every major
    // platform (Chrome/Edge/Safari/Firefox, desktop + mobile).  See the
    // `@media print` block in the CSS module for the print layout.
    window.print();
  }, []);

  const validity = useMemo(
    () => (state.kind === 'ready' ? formatValidUntil(state.pass.validUntil) : null),
    [state],
  );

  // Update document title and theme color for the public share page.  We
  // deliberately revert them on unmount so deep-linking doesn't leak into the
  // admin SPA if the user later navigates back.
  useEffect(() => {
    const prevTitle = document.title;
    document.title = 'Гостевой пропуск — DomHub';
    return () => { document.title = prevTitle; };
  }, []);

  return (
    <div className={styles.root}>
      <div className={styles.page}>
        <header className={styles.header}>
          <div className={styles.wordmark}>
            <svg
              className={styles.wordmarkIcon}
              viewBox="0 0 22 22"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="2" y="5" width="8" height="12" rx="2" />
              <path d="M10 9h3a4 4 0 0 1 0 8h-3" />
            </svg>
            <span className={styles.wordmarkText}>DomHub</span>
          </div>
          {state.kind === 'ready' && state.pass.propertyName && (
            <div className={styles.propertyName}>{state.pass.propertyName}</div>
          )}
        </header>

        {state.kind === 'loading' && (
          <div className={styles.loading}>Загружаем пропуск…</div>
        )}

        {state.kind === 'error' && (
          <div className={styles.errorBox} role="alert" aria-live="assertive">{state.message}</div>
        )}

        {state.kind === 'ready' && (
          <>
            <div className={styles.statusRow}>
              <div
                className={`${styles.statusPill} ${state.pass.status === 'valid' ? styles.statusPillValid : styles.statusPillInvalid}`}
                aria-live="polite"
              >
                <span className={styles.statusDot} />
                {statusLabel(state.pass.status)}
              </div>
            </div>

            <div className={styles.passCard} role="main" aria-label="Гостевой пропуск">
              <div className={styles.cardHeader}>
                <div className={styles.cardLabel}>Гостевой пропуск</div>
                <div className={styles.visitorName}>
                  {state.pass.visitorName || 'Гость'}
                </div>
                {state.pass.apartment && (
                  <div className={styles.visitorDest}>
                    Апартаменты {state.pass.apartment}
                  </div>
                )}
              </div>

              <div className={styles.qrFrame}>
                <div className={styles.qrCode} aria-label="QR-код для прохода">
                  {state.qrDataUrl ? (
                    <img src={state.qrDataUrl} alt="QR-код пропуска" />
                  ) : (
                    <div className={styles.qrCodePlaceholder}>
                      QR недоступен. Покажите эту страницу охране.
                    </div>
                  )}
                </div>
                <div className={styles.qrHint}>
                  Покажите этот код охране на входе
                </div>
              </div>

              <div className={styles.validityRow}>
                <div className={styles.validityCell}>
                  <div className={styles.validityLabel}>Действует до</div>
                  <div className={styles.validityValue}>
                    {validity ? (
                      <>
                        {validity.date}
                        <br />
                        {validity.time}
                      </>
                    ) : (
                      '—'
                    )}
                  </div>
                </div>
                <div className={styles.validityDivider} />
                <div className={styles.validityCell}>
                  <div className={styles.validityLabel}>Тип</div>
                  <div className={styles.validityValue}>
                    {typeLabel(state.pass.type)}
                    <br />
                    пропуск
                  </div>
                </div>
              </div>
            </div>

            {state.pass.status === 'valid' && (
              <div className={styles.metaChips} aria-label="Детали пропуска">
                <div className={styles.metaChip}>
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                    <circle cx="8" cy="8" r="6.5" />
                    <path d="M8 5v3.5l2.5 1.5" />
                  </svg>
                  Одноразовый проход
                </div>
              </div>
            )}

            <div className={styles.actionsRow}>
              <button
                type="button"
                className={styles.btnGhost}
                onClick={onPrint}
                aria-label="Сохранить пропуск как PDF"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M8 2v8M4 7l4 4 4-4" />
                  <path d="M2 13h12" />
                </svg>
                Сохранить как PDF
              </button>
            </div>

            <div className={styles.footerAttr}>
              Пропуск выписан через <strong>DomHub</strong>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
