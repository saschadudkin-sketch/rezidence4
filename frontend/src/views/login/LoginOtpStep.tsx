import type { CSSProperties } from 'react';

type LoginOtpStepProps = {
  phone: string;
  otp: string;
  setOtp: (value: string) => void;
  otpError: string;
  setOtpError: (value: string) => void;
  loading: boolean;
  sendAttempts: number;
  resendIn: number;
  otpWarnOnAttempt: number;
  otpCooldownSeconds: number;
  sendCode: () => Promise<void>;
  verify: (otpValue?: string) => Promise<void>;
  onBack: () => void;
};

export function LoginOtpStep({
  phone,
  otp,
  setOtp,
  otpError,
  setOtpError,
  loading,
  sendAttempts,
  resendIn,
  otpWarnOnAttempt,
  otpCooldownSeconds,
  sendCode,
  verify,
  onBack,
}: LoginOtpStepProps) {
  return (
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
          onChange={(e) => {
            const value = e.target.value.replace(/\D/g, '');
            setOtp(value);
            if (otpError) setOtpError('');
            if (value.length === 6) void verify(value);
          }}
          onKeyDown={(e) => e.key === 'Enter' && void verify()}
          autoComplete="one-time-code"
          autoFocus
          aria-invalid={Boolean(otpError)}
          aria-describedby={otpError ? 'login-code-err' : undefined}
        />
        {otpError && <div id="login-code-err" className="field-err" role="alert">{otpError}</div>}
      </div>
      <button className="btn-gold" onClick={() => { void verify(); }} disabled={loading}>
        <span>{loading ? 'Проверка...' : 'Войти'}</span>
      </button>

      {sendAttempts >= otpWarnOnAttempt && resendIn === 0 && (
        <div className="field-warn" role="alert">
          Слишком много попыток: следующая может заблокировать вход на несколько минут
        </div>
      )}
      {resendIn > 0 && (
        <div className="otp-countdown" aria-hidden="true">
          {/* eslint-disable-next-line no-restricted-syntax -- CSS variable drives transient progress width for the resend timer */}
          <div className="otp-countdown-bar" style={{ '--otp-progress': `${(resendIn / otpCooldownSeconds) * 100}%` } as CSSProperties} />
        </div>
      )}

      <button className="btn-text" onClick={() => { void sendCode(); }} disabled={loading || resendIn > 0}>
        {resendIn > 0 ? `Отправить повторно через ${resendIn}с` : 'Отправить код повторно'}
      </button>
      <button className="btn-text" onClick={onBack}>
        ← Изменить номер
      </button>
      <div className="login-help">
        <span className="login-help-text">Проблема со входом? </span>
        <a href="mailto:admin@rezidencia.ru" className="login-help-link">
          Связаться с администратором
        </a>
      </div>
    </>
  );
}
