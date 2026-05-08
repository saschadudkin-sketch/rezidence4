import { findByPhone } from '../../utils/phoneUtils';
import { OTP_COOLDOWN_SECONDS } from '../../constants/limits';
import { emitLoginMetric } from '../../utils/loginMetrics';
import { toast } from '../../ui/Toasts';
import type { AppUser } from '../../store/slices/usersSlice';

type DemoHint = readonly [phone: string, roleLabel: string];

type LoginPhoneStepProps = {
  phone: string;
  setPhone: (value: string) => void;
  phoneError: string;
  setPhoneError: (value: string) => void;
  loading: boolean;
  demoMode: boolean;
  demoOpen: boolean;
  setDemoOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
  hints: readonly DemoHint[];
  phoneDb: Record<string, AppUser>;
  setFound: (value: AppUser | null) => void;
  setOtp: (value: string) => void;
  setOtpError: (value: string) => void;
  setRecovery: (value: null) => void;
  setStep: (value: 'otp') => void;
  setResendIn: (value: number) => void;
  setPendingState: (updater: (prev: { send: boolean; verify: boolean; demo: boolean }) => { send: boolean; verify: boolean; demo: boolean }) => void;
  sendCode: () => Promise<void>;
};

export function LoginPhoneStep({
  phone,
  setPhone,
  phoneError,
  setPhoneError,
  loading,
  demoMode,
  demoOpen,
  setDemoOpen,
  hints,
  phoneDb,
  setFound,
  setOtp,
  setOtpError,
  setRecovery,
  setStep,
  setResendIn,
  setPendingState,
  sendCode,
}: LoginPhoneStepProps) {
  const demoListId = 'login-demo-list';

  return (
    <>
      <div className="field">
        <label className="field-lbl" htmlFor="login-phone">Номер телефона</label>
        <input
          id="login-phone"
          className="field-inp"
          type="tel"
          placeholder="+7 000 000-00-00"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            if (phoneError) setPhoneError('');
          }}
          onKeyDown={(e) => e.key === 'Enter' && void sendCode()}
          inputMode="tel"
          autoComplete="tel"
          autoFocus
          aria-invalid={Boolean(phoneError)}
          aria-describedby={phoneError ? 'login-phone-err' : undefined}
        />
        {phoneError && <div id="login-phone-err" className="field-err" role="alert" aria-live="assertive">{phoneError}</div>}
      </div>
      <button className="btn-gold" onClick={() => { void sendCode(); }} disabled={loading}>
        <span>{loading ? 'Проверка...' : 'Получить SMS-код'}</span>
      </button>

      {demoMode && (
        <button
          className={'demo-toggle' + (demoOpen ? ' open' : '')}
          onClick={() => setDemoOpen((open) => !open)}
          aria-expanded={demoOpen}
          aria-controls={demoListId}
        >
          <span>Демо-доступ</span>
          <span className="demo-toggle-arrow" aria-hidden="true">▾</span>
        </button>
      )}

      {demoMode && demoOpen && (
        <div id={demoListId} className="demo-list">
          {hints.map(([demoPhone, roleLabel]) => (
            <button
              key={demoPhone}
              className="demo-row"
              disabled={loading}
              onClick={async () => {
                setPhone(demoPhone);
                const matched = findByPhone(demoPhone, phoneDb);
                if (matched) {
                  setPendingState((prev) => ({ ...prev, demo: true }));
                  setFound(matched);
                  setOtp('');
                  setOtpError('');
                  setRecovery(null);
                  setDemoOpen(false);
                  await new Promise((resolve) => setTimeout(resolve, 300));
                  setStep('otp');
                  setResendIn(OTP_COOLDOWN_SECONDS);
                  setPendingState((prev) => ({ ...prev, demo: false }));
                  emitLoginMetric('send_code_success', {
                    mode: 'demo',
                    source: 'demo_shortcut',
                  });
                  toast('Демо: введите любой код', 'success');
                } else {
                  toast('Пользователь не найден в демо-данных', 'error');
                  setPendingState((prev) => ({ ...prev, demo: false }));
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
  );
}
