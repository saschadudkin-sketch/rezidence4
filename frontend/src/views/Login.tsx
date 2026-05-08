import { useState, useRef, useEffect, useCallback } from 'react';
import type { CSSProperties } from 'react';
import type { AppUser } from '../store/slices/usersSlice';
import { useUsers } from '../store/AppStore';
import { toast } from '../ui/Toasts';
import { isLiveMode, isDemoMode } from '../config/runtimeMode';
import { LOGO } from '../constants/logo';
import { OTP_COOLDOWN_SECONDS, OTP_RETRY_AFTER_MAX_SECONDS } from '../constants/limits';
import { formatPhone } from '../utils/phoneUtils';
import { emitLoginMetric } from '../utils/loginMetrics';
import { useAuthFlow } from '../hooks/useAuthFlow';
import { presentError } from '../ui/errorPresenter';
import ErrorRecoveryPanel from '../ui/ErrorRecoveryPanel';
import type { ServiceAck } from '../services/providers/serviceDtos';
import { LoginArt } from './login/LoginArt';
import { LoginPhoneStep } from './login/LoginPhoneStep';
import { LoginOtpStep } from './login/LoginOtpStep';

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
        const resetPhone = () => {
          setPhone('+7 ');
          setPhoneError('');
          setRecovery(null);
        };
        if (!signal.aborted) toast('Номер не найден в системе', 'error');
        setPhoneError(demoMode ? 'Номер не найден в демо-данных' : 'Номер не найден в системе');
        setRecovery({
          message: demoMode
            ? 'Номер не найден. Проверьте номер или используйте демо-доступ.'
            : 'Номер не найден. Проверьте цифры или очистите поле и введите номер заново.',
          onRetry: () => sendCode(),
          onFallback: demoMode ? () => setDemoOpen(true) : resetPhone,
          fallbackLabel: demoMode ? 'Открыть демо-доступ' : 'Очистить номер',
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
    <>
      <a className="skip-link" href="#main-content">Перейти к форме входа</a>
      <main className="login" id="main-content" tabIndex={-1}>
      <LoginArt />

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
            <LoginPhoneStep
              phone={phone}
              setPhone={(value) => setPhone(formatPhone(value))}
              phoneError={phoneError}
              setPhoneError={setPhoneError}
              loading={loading}
              demoMode={demoMode}
              demoOpen={demoOpen}
              setDemoOpen={setDemoOpen}
              hints={HINTS}
              phoneDb={phoneDb}
              setFound={setFound}
              setOtp={setOtp}
              setOtpError={setOtpError}
              setRecovery={setRecovery}
              setStep={setStep}
              setResendIn={setResendIn}
              setPendingState={setPendingState}
              sendCode={sendCode}
            />
          ) : (
            <LoginOtpStep
              phone={phone}
              otp={otp}
              setOtp={setOtp}
              otpError={otpError}
              setOtpError={setOtpError}
              loading={loading}
              sendAttempts={sendAttempts}
              resendIn={resendIn}
              otpWarnOnAttempt={OTP_WARN_ON_ATTEMPT}
              otpCooldownSeconds={OTP_COOLDOWN_SECONDS}
              sendCode={sendCode}
              verify={verify}
              onBack={() => {
                setStep('phone');
                setOtp('');
                setFound(null);
              }}
            />
          )}
        </div>
        <div className="login-panel-balance" aria-hidden="true" />
      </div>
      </main>
    </>
  );
}
