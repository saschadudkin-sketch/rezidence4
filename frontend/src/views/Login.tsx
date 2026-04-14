import { useState, useRef, useEffect, useCallback } from 'react';
import type { CSSProperties } from 'react';
import type { AppUser } from '../store/slices/usersSlice';
import { useUsers } from '../store/AppStore';
import { findByPhone } from '../utils/phoneUtils';
import { toast } from '../ui/Toasts';
import { isLiveMode, isDemoMode } from '../config/runtimeMode';
import { LOGO } from '../constants/logo';
import { AppIcon } from '../ui/AppIcon';
import { OTP_COOLDOWN_SECONDS, OTP_RETRY_AFTER_MAX_SECONDS } from '../constants/limits';
import { formatPhone } from '../utils/phoneUtils';
import { emitLoginMetric } from '../utils/loginMetrics';
import { useAuthFlow } from '../hooks/useAuthFlow';
import { presentError } from '../ui/errorPresenter';
import ErrorRecoveryPanel from '../ui/ErrorRecoveryPanel';
import type { ServiceAck } from '../services/providers/serviceDtos';

// Показываем мягкое предупреждение уже со второй повторной отправки OTP.
const OTP_WARN_ON_ATTEMPT = 2;
type LoginStep = 'phone' | 'otp';
type PendingState = { send: boolean; verify: boolean; demo: boolean };
type RecoveryState = {
  message: string;
  onRetry: () => void;
  onFallback: () => void;
  fallbackLabel: string;
} | null;
type DemoHint = readonly [phone: string, roleLabel: string];
type AuthFlowError = {
  notFound?: boolean;
  retryAfter?: string | number;
  status?: number;
  message?: string;
  kind?: string;
};

function isAppUser(value: ServiceAck | AppUser | void | null): value is AppUser {
  return typeof value === 'object' && value !== null && 'uid' in value;
}

const HINTS = isDemoMode()
  ? [
      ['+7 916 123-45-67', 'Собственник · апарт. 12'],
      ['+7 929 234-56-78', 'Арендатор · апарт. 34'],
      ['+7 903 345-67-89', 'Подрядчик'],
      ['+7 925 456-78-90', 'Консьерж'],
      ['+7 917 567-89-01', 'Охрана'],
      ['+7 495 123-00-00', 'Администратор'],
    ] satisfies readonly DemoHint[]
  : [];

export default function Login({ onLogin, authNotice = '' }: { onLogin: (user: AppUser) => void; authNotice?: string }) {
  const demoMode = isDemoMode();
  const [phone, setPhone] = useState<string>('+7 ');
  const [otp, setOtp] = useState<string>('');
  const [step, setStep] = useState<LoginStep>('phone');
  const [pending, setPendingState] = useState<PendingState>({ send: false, verify: false, demo: false });
  // FIX [TYPES]: found типизирован как AppUser | null (ранее null без generic)
  const [found, setFound] = useState<AppUser | null>(null);
  const [demoOpen, setDemoOpen] = useState<boolean>(false);
  const [phoneError, setPhoneError] = useState<string>('');
  const [otpError, setOtpError] = useState<string>('');
  const [resendIn, setResendIn] = useState<number>(0);
  const [recovery, setRecovery] = useState<RecoveryState>(null);
  const [sendAttempts, setSendAttempts] = useState<number>(0);
  const [mobileViewportHeight, setMobileViewportHeight] = useState<number | null>(null);
  const { phoneDb } = useUsers();
  const authFlow = useAuthFlow();

  // Отменяем старые запросы, если пользователь быстро повторяет действия.
  const abortRef = useRef<AbortController | null>(null);

  // FIX [CLEANUP]: при unmount отменяем in-flight запросы, чтобы не тратить
  // ресурсы сервера и избежать setState на размонтированном компоненте.
  useEffect(() => () => { abortRef.current?.abort(); }, []);
  const currentRequestIdRef = useRef({ send: 0, verify: 0 });
  const requestSeqRef = useRef(0);
  const loading = pending.send || pending.verify || pending.demo;

  const nextRequestId = useCallback((kind: 'send' | 'verify') => {
    const reqId = ++requestSeqRef.current;
    currentRequestIdRef.current[kind] = reqId;
    return reqId;
  }, []);

  const setPending = useCallback((kind: 'send' | 'verify', value: boolean, reqId: number) => {
    // takeLatest: pending-флаг меняет только последний актуальный запрос этого канала.
    if (currentRequestIdRef.current[kind] !== reqId) return;
    setPendingState(prev => (prev[kind] === value ? prev : { ...prev, [kind]: value }));
  }, []);

  useEffect(() => {
    if (step !== 'otp' || resendIn <= 0) return;
    const timer = setInterval(() => {
      setResendIn(value => (value > 0 ? value - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [step, resendIn]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const updateViewportHeight = () => {
      const width = window.innerWidth;
      if (width > 1024) {
        setMobileViewportHeight(null);
        return;
      }

      const nextHeight = window.visualViewport?.height ?? window.innerHeight;
      setMobileViewportHeight(Math.round(nextHeight));
    };

    updateViewportHeight();
    window.addEventListener('resize', updateViewportHeight);
    window.visualViewport?.addEventListener('resize', updateViewportHeight);
    window.visualViewport?.addEventListener('scroll', updateViewportHeight);

    return () => {
      window.removeEventListener('resize', updateViewportHeight);
      window.visualViewport?.removeEventListener('resize', updateViewportHeight);
      window.visualViewport?.removeEventListener('scroll', updateViewportHeight);
    };
  }, []);

  const loginPanelStyle = mobileViewportHeight
    ? ({ '--login-mobile-vh': `${mobileViewportHeight}px` } as CSSProperties)
    : undefined;

  const sendCode = async () => {
    if (pending.send) return;

    const isResend = step === 'otp';
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 11) {
      setPhoneError('Проверьте формат номера телефона');
      emitLoginMetric(isResend ? 'resend_rejected' : 'send_code_rejected', { reason: 'phone_format' });
      toast('Введите корректный номер', 'error');
      return;
    }

    setPhoneError('');
    setRecovery(null);

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const { signal } = abortRef.current;
    const reqId = nextRequestId('send');

    setPending('send', true, reqId);
    try {
      const demoUser = await authFlow.sendOtp(phone);
      if (signal.aborted) return;

      if (isAppUser(demoUser)) setFound(demoUser);
      setStep('otp');
      setResendIn(OTP_COOLDOWN_SECONDS);
      setOtpError('');
      setRecovery(null);
      setSendAttempts(count => count + 1);
      emitLoginMetric(isResend ? 'resend_success' : 'send_code_success', {
        mode: isLiveMode() ? 'live' : 'demo',
      });
      toast(isLiveMode() ? 'SMS-код отправлен' : 'Демо: введите любой код', 'success');
    } catch (e: unknown) {
      const error = e as AuthFlowError;
      if (error.notFound) {
        if (!signal.aborted) toast('Номер не найден в системе', 'error');
        setPhoneError('Номер не найден в демо-данных');
        setRecovery({
          message: 'Номер не найден. Проверьте номер или используйте демо-доступ.',
          onRetry: () => sendCode(),
          onFallback: () => setDemoOpen(true),
          fallbackLabel: 'Открыть демо-доступ',
        });
      } else {
        // Не даем серверу заблокировать экран слишком длинным retryAfter.
        const retryAfter = Math.min(
          parseInt(String(error.retryAfter ?? OTP_COOLDOWN_SECONDS), 10) || OTP_COOLDOWN_SECONDS,
          OTP_RETRY_AFTER_MAX_SECONDS,
        );
        setResendIn(retryAfter);
        setSendAttempts(count => count + 1);
        setPhoneError('Не удалось отправить код. Попробуйте ещё раз');
        emitLoginMetric(isResend ? 'resend_failed' : 'send_code_failed', {
          mode: isLiveMode() ? 'live' : 'demo',
        });
        if (!signal.aborted) toast(presentError(error, 'auth.send_code').message, 'error');
        setRecovery({
          message: 'Код не отправлен. Мы уже попробовали повторно на сервере, попробуйте снова вручную.',
          onRetry: () => sendCode(),
          onFallback: () => setDemoOpen(true),
          fallbackLabel: demoMode ? 'Открыть демо-доступ' : 'Вернуться к номеру',
        });
      }
    } finally {
      setPending('send', false, reqId);
    }
  };

  // При автоподтверждении берем код напрямую из аргумента, а не из потенциально устаревшего state.
  const verify = async (otpValue?: string) => {
    if (pending.verify) return;

    const code = typeof otpValue === 'string' ? otpValue : otp;
    if (code.length !== 6) {
      setOtpError('Код должен содержать 6 цифр');
      emitLoginMetric('verify_rejected', { reason: 'otp_too_short' });
      toast('Введите код из SMS', 'error');
      return;
    }

    setOtpError('');
    setRecovery(null);

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const { signal } = abortRef.current;
    const reqId = nextRequestId('verify');

    setPending('verify', true, reqId);
    try {
      const user = await authFlow.verifyOtp(phone, code, found);
      if (signal.aborted) return;
      if (!user) {
        throw new Error('Auth flow returned no user');
      }
      emitLoginMetric('verify_success', { mode: isLiveMode() ? 'live' : 'demo' });
      toast.clearAll?.();
      onLogin(user);
    } catch (e: unknown) {
      setOtpError('Неверный код. Проверьте и попробуйте снова');
      emitLoginMetric('verify_failed', { mode: isLiveMode() ? 'live' : 'demo' });
      if (!signal.aborted) toast(presentError(e, 'auth.verify').message, 'error');
      setRecovery({
        message: 'Проверка кода не удалась. Повторите попытку или запросите новый код.',
        onRetry: () => verify(code),
        onFallback: () => setStep('phone'),
        fallbackLabel: 'Изменить номер',
      });
    } finally {
      setPending('verify', false, reqId);
    }
  };

  return (
    <div className="login">
      <div className="login-art" aria-hidden="true">
        <div className="login-art-brand">
          <img src={LOGO} alt="Резиденции Замоскворечья" className="login-art-logo" />
          <div>
            <div className="login-art-name">Резиденции Замоскворечья</div>
            <div className="login-art-tagline">Приватная система доступа и сервиса</div>
          </div>
        </div>
        <div className="login-art-body">
          <div className="login-art-kicker">Закрытое приложение резиденции</div>
          <div className="login-art-headline">
            Элегантное управление
            <br />
            доступом
          </div>
          <div className="login-art-intro">
            <p className="login-art-lead">
              Персональное закрытое приложение для жителей и персонала, ваш ключ к безупречному
              сервису.
            </p>
            <ul className="login-art-list">
              <li>Интеллектуальное оформление гостевых пропусков</li>
              <li>Удобные сервисные обращения с отслеживанием статуса</li>
              <li>Мгновенная связь с консьерж-службой и охраной</li>
              <li>Персонализированные уведомления</li>
            </ul>
          </div>
          <div className="login-art-metrics" aria-hidden="true">
            <div className="login-art-metric">
              <span className="login-art-metric-value">24/7</span>
              <span className="login-art-metric-label">консьерж-контур</span>
            </div>
            <div className="login-art-metric">
              <span className="login-art-metric-value">1 app</span>
              <span className="login-art-metric-label">пропуска и сервисы</span>
            </div>
            <div className="login-art-metric">
              <span className="login-art-metric-value">Private</span>
              <span className="login-art-metric-label">защищённый доступ</span>
            </div>
          </div>
          <ul className="login-art-features">
            <li className="login-art-feature">
              <div className="login-art-feature-icon">
                <AppIcon name="ticket" />
              </div>
              <div>
                <div className="login-art-feature-title">Пропуска за секунды</div>
                <div className="login-art-feature-desc">
                  Создавайте и отправляйте гостевые пропуска прямо с телефона
                </div>
              </div>
            </li>
            <li className="login-art-feature">
              <div className="login-art-feature-icon">
                <AppIcon name="bell" />
              </div>
              <div>
                <div className="login-art-feature-title">Уведомления в реальном времени</div>
                <div className="login-art-feature-desc">
                  Охрана получает пуш-уведомления на заблокированный экран
                </div>
              </div>
            </li>
            <li className="login-art-feature">
              <div className="login-art-feature-icon">
                <AppIcon name="file" />
              </div>
              <div>
                <div className="login-art-feature-title">Постоянные списки</div>
                <div className="login-art-feature-desc">
                  Сохраняйте частых гостей и шаблоны заявок
                </div>
              </div>
            </li>
          </ul>
        </div>
        <div className="login-art-footer">
          <div className="login-art-quote">Безопасность и комфорт в одном приложении</div>
        </div>
      </div>

      <div className="login-panel" style={loginPanelStyle}>
        <div className="login-panel-balance" aria-hidden="true" />
        <div className="login-form">
          <div className="login-mobile-top">
            <img src={LOGO} alt="Резиденции Замоскворечья" />
            <div>
              <div>Резиденции Замоскворечья</div>
              <div className="login-mobile-tagline">Система управления доступом</div>
            </div>
          </div>
          <div className="login-mobile-hero" aria-hidden="true">
            Умное управление доступом: пропуска, уведомления и безопасность в одном приложении
          </div>
          <div className="login-form-intro">
            <div className="login-step">Шаг {step === 'phone' ? '1' : '2'} из 2</div>
            <h1 className="login-h">Вход в систему</h1>
            <div className="login-form-sub">
              Используйте номер телефона, привязанный к апартаменту или сотруднику резиденции.
            </div>
          </div>

          {authNotice && (
            <div className="field-warn" role="status" aria-live="polite">
              {authNotice}
            </div>
          )}

          {recovery && (
            <ErrorRecoveryPanel
              message={recovery.message}
              onRetry={recovery.onRetry}
              onFallback={recovery.onFallback}
              fallbackLabel={recovery.fallbackLabel}
            />
          )}

          {step === 'phone' ? (
            <>
              <div className="field">
                <label className="field-lbl" htmlFor="login-phone">Номер телефона</label>
                <input
                  id="login-phone"
                  className="field-inp"
                  type="tel"
                  placeholder="+7 000 000-00-00"
                  value={phone}
                  onChange={e => {
                    setPhone(formatPhone(e.target.value));
                    if (phoneError) setPhoneError('');
                  }}
                  onKeyDown={e => e.key === 'Enter' && sendCode()}
                  inputMode="tel"
                  autoComplete="tel"
                  autoFocus
                />
                {phoneError && <div className="field-err">{phoneError}</div>}
              </div>
              <button className="btn-gold" onClick={sendCode} disabled={loading}>
                <span>{loading ? 'Проверка...' : 'Получить SMS-код'}</span>
              </button>

              {demoMode && (
                <button
                  className={'demo-toggle' + (demoOpen ? ' open' : '')}
                  onClick={() => setDemoOpen(open => !open)}
                >
                  <span>Демо-доступ</span>
                  <span className="demo-toggle-arrow">▾</span>
                </button>
              )}

              {demoMode && demoOpen && (
                <div className="demo-list">
                  {HINTS.map(([demoPhone, roleLabel]) => (
                    <button
                      key={demoPhone}
                      className="demo-row"
                      disabled={loading}
                      onClick={async () => {
                        setPhone(demoPhone);
                        const matched = findByPhone(demoPhone, phoneDb);
                        if (matched) {
                          setPendingState(prev => ({ ...prev, demo: true }));
                          setFound(matched);
                          setOtp('');
                          setOtpError('');
                          setRecovery(null);
                          setDemoOpen(false);
                          await new Promise(resolve => setTimeout(resolve, 300));
                          setStep('otp');
                          setResendIn(OTP_COOLDOWN_SECONDS);
                          setPendingState(prev => ({ ...prev, demo: false }));
                          emitLoginMetric('send_code_success', {
                            mode: 'demo',
                            source: 'demo_shortcut',
                          });
                          toast('Демо: введите любой код', 'success');
                        } else {
                          toast('Пользователь не найден в демо-данных', 'error');
                          setPendingState(prev => ({ ...prev, demo: false }));
                        }
                      }}
                    >
                      <span className="demo-ph">{demoPhone}</span>
                      <span className="demo-rl">{roleLabel}</span>
                    </button>
                  ))}
                </div>
              )}

              {!demoMode && (
                <div className="login-help">
                  <span className="login-help-text">Номер изменился? </span>
                  <a href="mailto:admin@rezidencia.ru" className="login-help-link">
                    Напишите администратору
                  </a>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="login-otp-phone">
                Код отправлен на <strong>{phone}</strong>
              </div>
              <div className="field">
                <label className="field-lbl" htmlFor="login-code">Код из SMS</label>
                <input
                  id="login-code"
                  className="field-inp field-otp"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="• • • • • •"
                  value={otp}
                  onChange={e => {
                    const value = e.target.value.replace(/\D/g, '');
                    setOtp(value);
                    if (otpError) setOtpError('');
                    if (value.length === 6) verify(value);
                  }}
                  onKeyDown={e => e.key === 'Enter' && verify()}
                  autoComplete="one-time-code"
                  autoFocus
                />
                {otpError && <div className="field-err">{otpError}</div>}
              </div>
              <button className="btn-gold" onClick={() => { void verify(); }} disabled={loading}>
                <span>{loading ? 'Проверка...' : 'Войти'}</span>
              </button>

              {sendAttempts >= OTP_WARN_ON_ATTEMPT && resendIn === 0 && (
                <div className="field-warn" role="alert">
                  Слишком много попыток: следующая может заблокировать вход на несколько минут
                </div>
              )}
              {/* FIX [CODE]: IIFE в JSX заменён на читаемую переменную */}
              {resendIn > 0 && (
                <div className="otp-countdown" aria-hidden="true">
                  <div
                    className="otp-countdown-bar"
                    style={{ '--otp-progress': `${(resendIn / OTP_COOLDOWN_SECONDS) * 100}%` } as CSSProperties}
                  />
                </div>
              )}

              <button className="btn-text" onClick={sendCode} disabled={loading || resendIn > 0}>
                {resendIn > 0
                  ? `Отправить повторно через ${resendIn}с`
                  : 'Отправить код повторно'}
              </button>
              <button
                className="btn-text"
                onClick={() => {
                  setStep('phone');
                  setOtp('');
                  setFound(null);
                }}
              >
                ← Изменить номер
              </button>
              <div className="login-help">
                <span className="login-help-text">Проблема со входом? </span>
                <a href="mailto:admin@rezidencia.ru" className="login-help-link">
                  Связаться с администратором
                </a>
              </div>
            </>
          )}
        </div>
        <div className="login-panel-balance" aria-hidden="true" />
      </div>
    </div>
  );
}
