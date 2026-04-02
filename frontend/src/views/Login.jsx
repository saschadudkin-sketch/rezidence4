import { useState, useRef, useEffect } from 'react';
import { useUsers } from '../store/AppStore';
import { findByPhone } from '../utils.js';
import { toast } from '../ui/Toasts';
import { isLiveMode, isDemoMode } from '../config/runtimeMode.js';
import { LOGO } from '../constants/logo';
import { authProvider } from '../services/providers/backendProvider';
import { AppIcon } from '../ui/AppIcon';

// FIX [AUDIT-2 #15]: демо-данные с телефонами НЕ попадают в production JS-бандл
const HINTS = isDemoMode() ? [
  ['+7 916 123-45-67', 'Собственник · апарт. 12'],
  ['+7 929 234-56-78', 'Арендатор · апарт. 34'],
  ['+7 903 345-67-89', 'Подрядчик'],
  ['+7 925 456-78-90', 'Консьерж'],
  ['+7 917 567-89-01', 'Охрана'],
  ['+7 495 123-00-00', 'Администратор'],
] : [];

export default function Login({ onLogin }) {
  const [phone,     setPhone]     = useState('+7 ');
  const [otp,       setOtp]       = useState('');
  const [step,      setStep]      = useState('phone');
  const [loading,   setLoading]   = useState(false);
  const [found,     setFound]     = useState(null);
  const [demoOpen,  setDemoOpen]  = useState(false);
  const [phoneError, setPhoneError] = useState('');
  const [otpError, setOtpError] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const { phoneDb } = useUsers();

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
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 11) {
      setPhoneError('Проверьте формат номера телефона');
      toast('Введите корректный номер', 'error');
      return;
    }
    setPhoneError('');

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const { signal } = abortRef.current;

    setLoading(true);
    try {
      if (isLiveMode()) {
        await authProvider.sendOtp(phone);
        if (signal.aborted) return;
        setStep('otp');
        setResendIn(30);
        setOtpError('');
        toast('SMS-код отправлен', 'success');
      } else {
        const f = findByPhone(phone, phoneDb);
        if (!f) { toast('Номер не найден в системе', 'error'); setLoading(false); return; }
        await new Promise(r => setTimeout(r, 600));
        if (signal.aborted) return;
        setFound(f);
        setStep('otp');
        setResendIn(30);
        setOtpError('');
        toast('Демо: введите любой код', 'success');
      }
    } catch(e) {
      setPhoneError('Не удалось отправить код. Попробуйте ещё раз');
      if (!signal.aborted) toast('Не удалось отправить SMS. Проверьте номер.', 'error');
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  };

  const verify = async () => {
    if (otp.length < 4) {
      setOtpError('Код должен содержать минимум 4 цифры');
      toast('Введите код из SMS', 'error');
      return;
    }
    setOtpError('');

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const { signal } = abortRef.current;

    setLoading(true);
    try {
      if (isLiveMode()) {
        const user = await authProvider.verifyOtp(phone, otp);
        if (signal.aborted) return;
        onLogin(user);
      } else {
        await new Promise(r => setTimeout(r, 400));
        if (signal.aborted) return;
        onLogin(found);
      }
    } catch(e) {
      setOtpError('Неверный код. Проверьте и попробуйте снова');
      if (!signal.aborted) toast(e.message || 'Неверный код. Попробуйте ещё раз.', 'error');
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  };

  return (
    <div className="login">
      <div className="login-art">
        <div className="login-art-brand">
          <img src={LOGO} alt="" className="login-art-logo" />
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
            <img src={LOGO} alt="" />
            <span>Резиденции Замоскворечья</span>
          </div>
          <div className="login-step">Шаг {step === 'phone' ? '1' : '2'} из 2</div>
          <h1 className="login-h">Вход в систему</h1>

          {step === 'phone' ? (
            <>
              <div className="field">
                <label className="field-lbl">Номер телефона</label>
                <input
                  className="field-inp" type="tel" placeholder="+7 000 000-00-00"
                  value={phone} onChange={e => { setPhone(e.target.value); if (phoneError) setPhoneError(''); }}
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
                    <button key={p} className="demo-row" onClick={() => {
                      setPhone(p);
                      const f = findByPhone(p, phoneDb);
                      if (f) {
                        setFound(f);
                        setStep('otp');
                        setDemoOpen(false);
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
            </>
          ) : (
            <>
              <div className="field">
                <label className="field-lbl">Код из SMS</label>
                <input
                  className="field-inp field-otp" type="text"
                  inputMode="numeric" maxLength={6} placeholder="• • • •"
                  value={otp} onChange={e => { setOtp(e.target.value.replace(/\D/g, '')); if (otpError) setOtpError(''); }}
                  onKeyDown={e => e.key === 'Enter' && verify()}
                  autoComplete="one-time-code" autoFocus
                />
                {otpError && <div className="field-err">{otpError}</div>}
              </div>
              <button className="btn-gold" onClick={verify} disabled={loading}>
                <span>{loading ? 'Проверка...' : 'Войти'}</span>
              </button>
              <button className="btn-text" onClick={sendCode} disabled={loading || resendIn > 0}>
                {resendIn > 0 ? `Отправить код повторно через ${resendIn}с` : 'Отправить код повторно'}
              </button>
              <button className="btn-text" onClick={() => { setStep('phone'); setOtp(''); setFound(null); }}>
                ← Изменить номер
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
