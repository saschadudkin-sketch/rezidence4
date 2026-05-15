/**
 * GuardScannerView — standalone guard station scanner, /dashboard/guard/scan.
 *
 * Ported from docs/design-reference/guard-scanner.html.  Wires the reference
 * UI to the server-authoritative v1 scan API (see backend/src/v1/routes/visits.js,
 * mounted at /api/v1/guard/scan-pass).  Staff-only — the backend enforces this, but we
 * also redirect residents to the dashboard so the tablet doesn't render chrome
 * they can't use.
 *
 * Design intent (from the reference):
 *   — Large, decisive UI suitable for gate use under pressure.
 *   — Dark palette pinned regardless of the app theme (see .root in CSS).
 *   — One decisive success action after the server records the verdict.
 *   — "Online" badge = system liveness, not decoration.
 *
 * Flow:
 *   1. Camera opens, BarcodeDetector polls for QR every 300ms.
 *   2. On QR detected → extract token (URL or raw token) → POST /api/v1/guard/scan-pass.
 *   3. Server records the allow/deny decision and returns the guard verdict.
 *   4. "Сканировать ещё" resets to step 1 without full remount.
 *
 * Camera fallback: if BarcodeDetector is unavailable or getUserMedia fails,
 * we show a manual token-entry field so the guard can still validate a pass
 * by reading the token off the guest's screen.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './GuardScannerView.module.css';
import {
  scanPassToken,
  extractPassToken,
  GuardScanError,
  type GuardScanResult,
} from '../../shared/api/guardScanApi';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useAuth, PHASE } from '../../hooks/useAuth';
import { isStaff } from '../../domain/permissions';
import { toast } from '../../ui/Toasts';

type BarcodeDetectorResult = { rawValue: string };
type BarcodeDetectorLike = {
  detect: (image: HTMLVideoElement) => Promise<BarcodeDetectorResult[]>;
};
type BarcodeDetectorCtor = new (opts: { formats: string[] }) => BarcodeDetectorLike;
type BarcodeWindow = Window & { BarcodeDetector?: BarcodeDetectorCtor };

type ScanView =
  | { kind: 'scanning' }
  | { kind: 'checking' }
  | { kind: 'result'; scan: GuardScanResult }
  | { kind: 'error'; code: GuardScanError['code']; message: string };

function initials(name: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0] || '').join('').toUpperCase() || '?';
}

function formatValidUntil(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const date = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `${date}, до ${time}`;
}

function passTypeLabel(type: string): string {
  switch (type) {
    case 'pass':
    case 'visit': return 'Разовый гостевой пропуск';
    case 'delivery': return 'Доставка';
    case 'taxi': return 'Такси';
    case 'service': return 'Сервисный пропуск';
    default: return 'Пропуск';
  }
}

function errorHeadline(code: GuardScanError['code']): string {
  switch (code) {
    case 'NOT_FOUND': return 'Пропуск не найден';
    case 'PASS_EXPIRED': return 'Срок пропуска истёк';
    case 'PASS_INVALID': return 'Пропуск аннулирован';
    case 'FORBIDDEN': return 'Нет прав на сканирование';
    case 'VALIDATION': return 'Некорректный код';
    default: return 'Ошибка проверки';
  }
}

export default function GuardScannerView() {
  const navigate = useNavigate();
  const { phase, user } = useAuth();
  const isOnline = useOnlineStatus();

  const [view, setView] = useState<ScanView>({ kind: 'scanning' });
  const [manualEntry, setManualEntry] = useState('');
  const [cameraError, setCameraError] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Guards against the camera loop firing a duplicate scan after we've already
  // handed off to the server — BarcodeDetector can re-read the same QR frame.
  const lockRef = useRef(false);

  // Redirect non-staff users away — backend blocks them too (403), but the
  // guard station UI isn't useful to residents.
  useEffect(() => {
    if (phase === PHASE.DASHBOARD && user && !isStaff(user.role)) {
      navigate('/dashboard', { replace: true });
    }
  }, [phase, user, navigate]);

  useEffect(() => {
    const prevTitle = document.title;
    document.title = 'Охрана · Сканер — DomHub';
    return () => { document.title = prevTitle; };
  }, []);

  const stopCamera = useCallback(() => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const runScan = useCallback(async (token: string) => {
    const propertyId = (user as { property_id?: string | null } | null)?.property_id ?? null;
    if (!propertyId) {
      setView({ kind: 'error', code: 'VALIDATION', message: 'К пользователю не привязан объект.' });
      return;
    }
    lockRef.current = true;
    stopCamera();
    setView({ kind: 'checking' });
    try {
      const scan = await scanPassToken(propertyId, token);
      if (navigator.vibrate) navigator.vibrate(100);
      setView({ kind: 'result', scan });
    } catch (err) {
      const gErr = err as GuardScanError;
      setView({ kind: 'error', code: gErr.code, message: errorHeadline(gErr.code) });
    }
  }, [stopCamera, user]);

  const handleRawQr = useCallback((raw: string) => {
    if (lockRef.current) return;
    const token = extractPassToken(raw);
    if (!token) {
      // Don't reset state — a passing pedestrian's unrelated QR shouldn't
      // kick the guard out of the scanning view.  Just flash a toast.
      toast('Неизвестный формат QR', 'info');
      return;
    }
    void runScan(token);
  }, [runScan]);

  // Camera lifecycle — only active while `view.kind === 'scanning'`.
  useEffect(() => {
    if (view.kind !== 'scanning') return;
    let cancelled = false;
    lockRef.current = false;
    setCameraError(false);

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        const barcodeWindow = window as BarcodeWindow;
        if (!barcodeWindow.BarcodeDetector) {
          // Modern iOS Safari exposes it; older browsers need a polyfill we
          // don't bundle here.  The manual-entry row remains available below.
          return;
        }
        const detector = new barcodeWindow.BarcodeDetector({ formats: ['qr_code'] });
        scanIntervalRef.current = setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes.length && !lockRef.current) handleRawQr(codes[0].rawValue);
          } catch {
            // Individual frame decode errors are normal — ignore.
          }
        }, 300);
      } catch {
        if (!cancelled) setCameraError(true);
      }
    })();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [view.kind, stopCamera, handleRawQr]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const handleManualSubmit = useCallback(() => {
    const raw = manualEntry.trim();
    if (!raw) return;
    handleRawQr(raw);
  }, [manualEntry, handleRawQr]);

  const handleRescan = useCallback(() => {
    setView({ kind: 'scanning' });
    setManualEntry('');
  }, []);

  const scan = view.kind === 'result' ? view.scan : null;

  const headline = useMemo(() => {
    if (view.kind === 'result') return 'Пропуск действителен';
    if (view.kind === 'error') return view.message;
    return '';
  }, [view]);

  const sub = useMemo(() => {
    if (view.kind !== 'result') return '';
    const now = new Date();
    return `Проверка пройдена · ${now.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}`;
  }, [view]);

  return (
    <div className={styles.root}>
      <header className={styles.topbar}>
        <div className={styles.topbarLeft}>
          <button
            type="button"
            className={styles.backBtn}
            aria-label="Назад"
            onClick={() => navigate('/dashboard')}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 2L5 7l4 5" />
            </svg>
          </button>
          <div className={styles.topbarTitle}>
            Охрана<span>·</span>Сканер
          </div>
        </div>
        <div
          className={`${styles.onlineBadge} ${isOnline ? '' : styles.onlineBadgeOffline}`}
          aria-label={isOnline ? 'Система в сети' : 'Нет соединения'}
        >
          <span className={styles.onlineDot} aria-hidden="true" />
          {isOnline ? 'Онлайн' : 'Офлайн'}
        </div>
      </header>

      <div className={styles.content}>
        {view.kind === 'scanning' && (
          <>
            <div className={styles.viewport}>
              {cameraError ? (
                <div className={styles.cameraFallback}>
                  <div>Камера недоступна.</div>
                  <div>Введите токен пропуска вручную ниже.</div>
                </div>
              ) : (
                <>
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    aria-label="Предпросмотр камеры для проверки QR"
                    aria-describedby="guard-scanner-camera-hint"
                  />
                  <div className={styles.viewportFrame} aria-hidden="true" />
                  <div id="guard-scanner-camera-hint" className={styles.viewportHint}>Наведите камеру на QR-код гостя</div>
                </>
              )}
            </div>
            <div className={styles.manualRow}>
              <input
                className={styles.manualInput}
                value={manualEntry}
                onChange={(e) => setManualEntry(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleManualSubmit(); }}
                aria-label="Ссылка или токен пропуска"
                placeholder="Вставьте ссылку или токен пропуска"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
              <button type="button" className={styles.manualSubmit} onClick={handleManualSubmit}>
                Проверить
              </button>
            </div>
          </>
        )}

        {view.kind === 'checking' && (
          <div className={styles.loadingPanel}>
            <div className={styles.spinner} aria-hidden="true" />
            Проверяем пропуск…
          </div>
        )}

        {view.kind === 'error' && (
          <>
            <div className={`${styles.statusBanner} ${styles.statusBannerErr}`} role="alert" aria-live="polite">
              <div className={`${styles.statusIcon} ${styles.statusIconErr}`} aria-hidden="true">
                <svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 7l12 12M19 7L7 19" />
                </svg>
              </div>
              <div className={styles.statusText}>
                <div className={`${styles.statusHeadline} ${styles.statusHeadlineErr}`}>{headline}</div>
                <div className={styles.statusSub}>Пропустить гостя нельзя. Свяжитесь с резидентом.</div>
              </div>
            </div>
            <button type="button" className={styles.btnRescan} onClick={handleRescan}>
              Сканировать ещё
            </button>
          </>
        )}

        {view.kind === 'result' && scan && (
          <>
            <div
              className={`${styles.statusBanner} ${styles.statusBannerOk}`}
              role="alert" aria-live="polite"
            >
              <div className={`${styles.statusIcon} ${styles.statusIconOk}`} aria-hidden="true">
                <svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 13l5.5 6L21 7" />
                </svg>
              </div>
              <div className={styles.statusText}>
                <div className={`${styles.statusHeadline} ${styles.statusHeadlineOk}`}>{headline}</div>
                <div className={styles.statusSub}>{sub}</div>
              </div>
            </div>

            <div className={styles.guestCard} aria-label="Данные гостя">
              <div className={styles.guestIdentity}>
                <div className={styles.guestAvatar} aria-hidden="true">
                  {initials(scan.request.visitorName)}
                </div>
                <div className={styles.guestNameBlock}>
                  <div className={styles.guestName}>
                    {scan.request.visitorName || 'Гость без имени'}
                  </div>
                  <div className={styles.guestPassType}>
                    {passTypeLabel(scan.request.type)}
                  </div>
                </div>
              </div>

              <div className={styles.guestDetails}>
                <div className={styles.detailRow}>
                  <div className={styles.detailLabel}>
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M8 2C5.2 2 3 4.2 3 7c0 4 5 9 5 9s5-5 5-9c0-2.8-2.2-5-5-5z" />
                      <circle cx="8" cy="7" r="2" />
                    </svg>
                    Направляется в
                  </div>
                  <div className={styles.detailValue}>
                    {scan.resident.apartment
                      ? `Апарт. ${scan.resident.apartment}`
                      : '—'}
                  </div>
                </div>

                <div className={styles.detailRow}>
                  <div className={styles.detailLabel}>
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="8" cy="6" r="3" />
                      <path d="M2 14c0-3 2.7-5 6-5s6 2 6 5" />
                    </svg>
                    Приглашён резидентом
                  </div>
                  <div className={styles.detailValue}>
                    {scan.resident.name || 'Резидент'}
                  </div>
                </div>

                <div className={styles.detailRow}>
                  <div className={styles.detailLabel}>
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="8" cy="8" r="6.5" />
                      <path d="M8 5v3.5l2.5 1.5" />
                    </svg>
                    Действует
                  </div>
                  <div className={styles.detailValue}>
                    {formatValidUntil(scan.pass.expiresAt)}
                  </div>
                </div>

                <div className={styles.detailRow}>
                  <div className={styles.detailLabel}>
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="2" y="4" width="12" height="10" rx="2" />
                      <path d="M5 2v4M11 2v4M2 8h12" />
                    </svg>
                    Статус пропуска
                  </div>
                  <div className={`${styles.detailValue} ${scan.pass.usedAt ? '' : styles.detailValueOk}`}>
                    {scan.pass.usedAt ? 'Уже использован' : 'Не использован'}
                  </div>
                </div>
              </div>
            </div>

            <div className={styles.actionButtons}>
              <button
                type="button"
                className={styles.btnAdmit}
                onClick={handleRescan}
                aria-label="Сканировать следующий пропуск"
              >
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 10l4.5 5L16 5" />
                </svg>
                Проход разрешён
              </button>
              <button type="button" className={styles.btnRescan} onClick={handleRescan}>
                Сканировать ещё
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
