import React, { useState, FormEvent } from 'react';
import { useAuth } from '../auth';
import s from '../styles.module.css';

/**
 * LoginPage — email/password entry for platform admins.
 *
 * The backend rate-limits /platform/api/v1/auth/login via `platformAuthLimiter`
 * (see registerApiRoutes.js), so spamming the form just walks the caller into
 * a 429.  Errors are displayed inline; we intentionally don't say whether the
 * email or password was wrong.
 */
export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await login(email.trim().toLowerCase(), password);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Не удалось войти';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={s.loginPage}>
      <form className={s.loginCard} onSubmit={onSubmit} noValidate>
        <h1 className={s.loginTitle}>DomHub</h1>
        <p className={s.loginSubtitle}>Панель управления платформой</p>

        {error && <div className={s.error}>{error}</div>}

        <div className={s.formRow}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            className={s.input}
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className={s.formRow}>
          <label htmlFor="password">Пароль</label>
          <input
            id="password"
            className={s.input}
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <button type="submit" className={`${s.btn} ${s.btnFull}`} disabled={submitting}>
          {submitting ? 'Вход…' : 'Войти'}
        </button>
      </form>
    </div>
  );
}
