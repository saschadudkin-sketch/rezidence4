/**
 * platform-v1 UI primitives.
 *
 * Intentionally minimal.  Consumers get: Button, Input, Select, Textarea,
 * Field, Card, Badge, Spinner, EmptyState, Alert, Stack/Inline/Toolbar
 * layout helpers.  All styled via CSS-vars from design-system/tokens.css —
 * no inline styles, no per-component CSS leaks.
 */

import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import styles from './ui.module.css';

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

// ─── Button ─────────────────────────────────────────────────────────────────

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  loading = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  const variantClass =
    variant === 'primary'
      ? styles.buttonPrimary
      : variant === 'secondary'
        ? styles.buttonSecondary
        : variant === 'danger'
          ? styles.buttonDanger
          : styles.buttonGhost;
  return (
    <button
      type={type}
      className={cx(styles.button, variantClass, className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}

// ─── Inputs ─────────────────────────────────────────────────────────────────

// eslint's no-empty-object-type disallows empty interfaces; keep props as a
// direct alias so callers still see "InputProps" in tooltips.
export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, ...rest }: InputProps) {
  return <input className={cx(styles.input, className)} {...rest} />;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  children?: ReactNode;
}

export function Select({ className, children, ...rest }: SelectProps) {
  return (
    <select className={cx(styles.select, className)} {...rest}>
      {children}
    </select>
  );
}

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export function Textarea({ className, ...rest }: TextareaProps) {
  return <textarea className={cx(styles.textarea, className)} {...rest} />;
}

export type LabelProps = LabelHTMLAttributes<HTMLLabelElement>;

export function Label({ className, children, ...rest }: LabelProps) {
  return (
    <label className={cx(styles.label, className)} {...rest}>
      {children}
    </label>
  );
}

export interface FieldProps {
  id?: string;
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Field({ id, label, hint, error, children, className }: FieldProps) {
  return (
    <div className={cx(styles.field, className)}>
      {label ? <Label htmlFor={id}>{label}</Label> : null}
      {children}
      {error ? <div className={styles.fieldError}>{error}</div> : null}
      {!error && hint ? <div className={styles.fieldHint}>{hint}</div> : null}
    </div>
  );
}

// ─── Card ───────────────────────────────────────────────────────────────────

export interface CardProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  elevated?: boolean;
  className?: string;
  children?: ReactNode;
}

export function Card({ title, subtitle, actions, elevated, className, children }: CardProps) {
  return (
    <section className={cx(styles.card, elevated && styles.cardElevated, className)}>
      {title || actions ? (
        <header className={styles.cardHeader}>
          <div>
            {title ? <h3 className={styles.cardTitle}>{title}</h3> : null}
            {subtitle ? <p className={styles.cardSubtitle}>{subtitle}</p> : null}
          </div>
          {actions ? <div className={styles.inline}>{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

// ─── Badge ──────────────────────────────────────────────────────────────────

export type BadgeTone = 'neutral' | 'success' | 'error' | 'warning' | 'info' | 'gold';

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}

export function Badge({ tone = 'neutral', children, className }: BadgeProps) {
  const toneClass = {
    neutral: styles.badgeNeutral,
    success: styles.badgeSuccess,
    error: styles.badgeError,
    warning: styles.badgeWarning,
    info: styles.badgeInfo,
    gold: styles.badgeGold,
  }[tone];
  return <span className={cx(styles.badge, toneClass, className)}>{children}</span>;
}

// ─── Spinner / Empty / Alerts ──────────────────────────────────────────────

export function Spinner({ className }: { className?: string }) {
  return <span className={cx(styles.spinner, className)} role="status" aria-label="loading" />;
}

export function EmptyState({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx(styles.emptyState, className)}>{children}</div>;
}

export interface AlertProps {
  tone?: 'error' | 'success' | 'warning' | 'info';
  children: ReactNode;
  className?: string;
}

export function Alert({ tone = 'info', children, className }: AlertProps) {
  const toneClass = {
    error: styles.alertError,
    success: styles.alertSuccess,
    warning: styles.alertWarning,
    info: '',
  }[tone];
  return (
    <div className={cx(styles.alert, toneClass, className)} role="alert">
      {children}
    </div>
  );
}

// ─── Layout helpers ────────────────────────────────────────────────────────

export function Stack({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx(styles.stack, className)}>{children}</div>;
}

export function Inline({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx(styles.inline, className)}>{children}</div>;
}

export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx(styles.toolbar, className)}>{children}</div>;
}

// ─── Exposed class names ───────────────────────────────────────────────────
// Expose the CSS-module class map so feature components can reuse the same
// utility classes without importing the module directly (one import, one
// source of truth).  Treat this as a narrow API: only read keys that are
// also referenced by this module's components above.
export const uiClasses = styles;
