import { useState, useRef, useEffect } from 'react';
import { useUsers } from '../store/AppStore';
import { findByPhone } from '../utils/phoneUtils';
import { toast } from '../ui/Toasts';
import { isLiveMode, isDemoMode } from '../config/runtimeMode';
import { LOGO } from '../constants/logo';
import { AppIcon } from '../ui/AppIcon';
import { OTP_COOLDOWN_SECONDS, OTP_RETRY_AFTER_MAX_SECONDS } from '../constants/limits';
import { formatPhone } from '../utils/phoneUtils';
import { emitLoginMetric } from '../utils/loginMetrics';
// CQ-01: live/demo auth branching moved out of component into a hook
import { useAuthFlow } from '../hooks/useAuthFlow';

// P-04: порог предупреждения — при N-й попытке отправки OTP показываем предупреждение
const OTP_WARN_ON_ATTEMPT = 2; // предупреждаем начиная со 2-й попытки (перед последней)

const HINTS = isDemoMode() ? [
  ['+7 916 123-45-67', 'Собственник · апарт. 12'],
  ['+7 929 234-56-78', 'Арендатор · апарт. 34'],
  ['+7 903 345-67-89', 'Подрядчик'],
  ['+7 925 456-78-90', 'Консьерж'],
  ['+7 917 567-89-01', 'Охрана'],
  ['+7 495 123-00-00', 'Администратор'],
] : [];

export default function Login({ onLogin, authNotice = '' }) {
  const [phone,     setPhone]     = useState('+7 ');
  const [otp,       setOtp]       = useState('');
  const [step,      setStep]      = useState('phone');
  const [loading,   setLoading]   = useState(false);
  const [found,     setFound]     = useState(null);
  const [demoOpen,  setDemoOpen]  = useState(false);
  const [phoneError, setPhoneError] = useState('');
  const [otpError, setOtpError] = useState('');
  const [resendIn, setResendIn] = useState(0);
  // P-04: счётчик попыток отправки OTP — показываем предупреждение перед блокировкой
  const [sendAttempts, setSendAttempts] = useState(0);
  const { phoneDb } = useUsers();
  // CQ-01: mode-aware auth — no isLiveMode() branches in component
  const authFlow = useAuthFlow();

  // AbortController — отменяет in-flight запросы при быстрой повторной отправке
  const abortRef = useRef(null);

  useEffect(() => {
    if (step !== 'otp' || resendIn <= 0) return;
    const timer = setInterval(() => {
      setResendIn(v => (v > 0 ? v - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [step, resendIn]);

  const sendCode = async () => {
    const isResend = step === 'otp';
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 11) {
      setPhoneError('Проверьте формат номера телефона');
      emitLoginMetric(isResend ? 'resend_rejected' : 'send_code_rejected', { reason: 'phone_format' });
      toast('Введите корректный номер', 'error');
      return;
    }
    setPhoneError('');

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const { signal } = abortRef.current;

    setLoading(true);
    try {
      // CQ-01: authFlow.sendOtp handles live vs. demo branching internally
      const demoUser = await authFlow.sendOtp(phone);
      if (signal.aborted) return;
      if (demoUser) setFound(demoUser); // demo mode returns the matched user
      setStep('otp');
      setResendIn(OTP_COOLDOWN_SECONDS);
      setOtpError('');
      setSendAttempts(n => n + 1);
      emitLoginMetric(isResend ? 'resend_success' : 'send_code_success', { mode: isLiveMode() ? 'live' : 'demo' });
      toast(isLiveMode() ? 'SMS-код отправлен' : 'Демо: введите любой код', 'success');
    } catch(e) {
      if (e.notFound) {
        // Demo: phone not in fixture data
        if (!signal.aborted) toast('Номер не найден в системе', 'error');
        setPhoneError('Номер не найден в демо-данных');
      } else {
        // SEC-02: clamp retryAfter — сервер (или MITM) может вернуть 999999 секунд, блокируя UI навсегда
        const retryAfter = Math.min(
          parseInt(e.retryAfter ?? OTP_COOLDOWN_SECONDS, 10) || OTP_COOLDOWN_SECONDS,
          OTP_RETRY_AFTER_MAX_SECONDS,
        );
        setResendIn(retryAfter);
        setSendAttempts(n => n + 1);
        setPhoneError('Не удалось отправить код. Попробуйте ещё раз');
        emitLoginMetric(isResend ? 'resend_failed' : 'send_code_failed', { mode: isLiveMode() ? 'live' : 'demo' });
        if (!signal.aborted) toast('Не удалось отправить SMS. Проверьте номер.', 'error');
      }
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  };

  // FIX [I-5]: accept optional otpValue so auto-submit can pass the value directly
  // (React state update is async — closure would read stale otp on immediate call)
  const verify = async (otpValue) => {
    const code = typeof otpValue === 'string' ? otpValue : otp;
    if (code.length !== 6) {
      setOtpError('Код должен содержать 6 цифр');
      emitLoginMetric('verify_rejected', { reason: 'otp_too_short' });
      toast('Введите код из SMS', 'error');
      return;
    }
    setOtpError('');

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const { signal } = abortRef.current;

    setLoading(true);
    try {
      // CQ-01: authFlow.verifyOtp handles live vs. demo branching internally
      const user = await authFlow.verifyOtp(phone, code, found);
      if (signal.aborted) return;
      emitLoginMetric('verify_success', { mode: isLiveMode() ? 'live' : 'demo' });
      onLogin(user);
    } catch(e) {
      setOtpError('Неверный код. Проверьте и попробуйте снова');
      emitLoginMetric('verify_failed', { mode: isLiveMode() ? 'live' : 'demo' });
      if (!signal.aborted) toast(e.message || 'Неверный код. Попробуйте ещё раз.', 'error');
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  };

  return (
    <div className="login">
      <div className="login-art" aria-hidden="true">
        <div className="login-art-brand">
          <img src={LOGO} alt="Резиденции Замоскворечья" className="login-art-logo" />
          <div>
            <div className="login-art-name">Резиденции Замоскворечья</div>
            <div className="login-art-tagline">Система управления доступом</div>
          </div>
        </div>
        <div className="login-art-body">
          <div className="login-art-headline">Умное управление<br />доступом в ваш дом</div>
          <ul className="login-art-features">
            <li className="login-art-feature">
              <div className="login-art-feature-icon"><AppIcon name="ticket" /></div>
              <div>
                <div className="login-art-feature-title">Пропуска за секунды</div>
                <div className="login-art-feature-desc">Создавайте и отправляйте гостевые пропуска прямо с телефона</div>
              </div>
            </li>
            <li className="login-art-feature">
              <div className="login-art-feature-icon"><AppIcon name="alert" /></div>
              <div>
                <div className="login-art-feature-title">Уведомления в реальном времени</div>
                <div className="login-art-feature-desc">Охрана получает пуш-уведомления на заблокированный экран</div>
              </div>
            </li>
            <li className="login-art-feature">
              <div className="login-art-feature-icon"><AppIcon name="list" /></div>
              <div>
                <div className="login-art-feature-title">Постоянные списки</div>
                <div className="login-art-feature-desc">Сохраняйте частых гостей и шаблоны заявок</div>
              </div>
            </li>
          </ul>
        </div>
        <div className="login-art-footer">
          <div className="login-art-quote">Безопасность и комфорт — в одном приложении</div>
        </div>
      </div>

      <div className="login-panel">
        <div className="login-form">
          <div className="login-mobile-top">
            <img src={LOGO} alt="Резиденции Замоскворечья" />
            <div>
              <div>Резиденции Замоскворечья</div>
              <div className="login-mobile-tagline">Система управления доступом</div>
            </div>
          </div>
          <div className="login-mobile-hero" aria-hidden="true">
            Умное управление доступом — пропуска, уведомления и безопасность в одном приложении
          </div>
          <div className="login-step">Шаг {step === 'phone' ? '1' : '2'} из 2</div>
          <h1 className="login-h">Вход в систему</h1>
          {authNotice && (
            <div className="field-warn" role="status" aria-live="polite">
              {authNotice}
            </div>
          )}

          {step === 'phone' ? (
            <>
              <div className="field">
                <label className="field-lbl">Номер телефона</label>
                <input
                  className="field-inp" type="tel" placeholder="+7 000 000-00-00"
                  value={phone} onChange={e => { setPhone(formatPhone(e.target.value)); if (phoneError) setPhoneError(''); }}
                  onKeyDown={e => e.key === 'Enter' && sendCode()}
                  inputMode="tel" autoComplete="tel" autoFocus
                />
                {phoneError && <div className="field-err">{phoneError}</div>}
              </div>
              <button className="btn-gold" onClick={sendCode} disabled={loading}>
                <span>{loading ? 'Проверка...' : 'Получить SMS-код'}</span>
              </button>

              {isDemoMode() && <button className={'demo-toggle' + (demoOpen ? ' open' : '')} onClick={() => setDemoOpen(o => !o)}>
                <span>Демо-доступ</span>
                <span className="demo-toggle-arrow">▾</span>
              </button>}
              {isDemoMode() && demoOpen && (
                <div className="demo-list">
                  {HINTS.map(([p, r]) => (
                    <button key={p} className="demo-row" disabled={loading} onClick={async () => {
                      setPhone(p);
                      const f = findByPhone(p, phoneDb);
                      if (f) {
                        setLoading(true);
                        setFound(f);
                        setOtp('');
                        setOtpError('');
                        setDemoOpen(false);
                        await new Promise(r => setTimeout(r, 300));
                        setStep('otp');
                        setResendIn(OTP_COOLDOWN_SECONDS);
                        setLoading(false);
                        emitLoginMetric('send_code_success', { mode: 'demo', source: 'demo_shortcut' });
                        toast('Демо: введите любой код', 'success');
                      } else {
                        toast('Пользователь не найден в демо-данных', 'error');
                      }
                    }}>
                      <span className="demo-ph">{p}</span>
                      <span className="demo-rl">{r}</span>
                    </button>
                  ))}
                </div>
              )}
              {!isDemoMode() && (
                <div className="login-help">
                  <span className="login-help-text">Номер изменился? </span>
                  <a href="mailto:admin@rezidencia.ru" className="login-help-link">Напишите администратору</a>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="login-otp-phone">
                Код отправлен на <strong>{phone}</strong>
              </div>
              <div className="field">
                <label className="field-lbl">Код из SMS</label>
                <input
                  className="field-inp field-otp" type="text"
                  inputMode="numeric" maxLength={6} placeholder="• • • • • •"
                  value={otp} onChange={e => { const v = e.target.value.replace(/\D/g, ''); setOtp(v); if (otpError) setOtpError(''); /* FIX [I-5]: auto-submit when all 6 digits entered */ if (v.length === 6) verify(v); }}
                  onKeyDown={e => e.key === 'Enter' && verify()}
                  autoComplete="one-time-code" autoFocus
                />
                {otpError && <div className="field-err">{otpError}</div>}
              </div>
              <button className="btn-gold" onClick={verify} disabled={loading}>
                <span>{loading ? 'Проверка...' : 'Войти'}</span>
              </button>
              {/* P-04: проактивное предупреждение о приближении к лимиту повторных отправок */}
              {sendAttempts >= OTP_WARN_ON_ATTEMPT && resendIn === 0 && (
                <div className="field-warn" role="alert">
                  Слишком много попыток — следующая может заблокировать вход на несколько минут
                </div>
              )}
              {/* P-01: visual OTP countdown — progress bar depletes as cooldown ticks down */}
              {resendIn > 0 && (
                <div className="otp-countdown" aria-hidden="true">
                  <div
                    className="otp-countdown-bar"
                    style={{ '--otp-progress': `${(resendIn / OTP_COOLDOWN_SECONDS) * 100}%` }}
                  />
                </div>
              )}
              <button className="btn-text" onClick={sendCode} disabled={loading || resendIn > 0}>
                {resendIn > 0 ? `Отправить повторно через ${resendIn}с` : 'Отправить код повторно'}
              </button>
              <button className="btn-text" onClick={() => { setStep('phone'); setOtp(''); setFound(null); }}>
                ← Изменить номер
              </button>
              <div className="login-help">
                <span className="login-help-text">Проблема со входом? </span>
                <a href="mailto:admin@rezidencia.ru" className="login-help-link">Связаться с администратором</a>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
