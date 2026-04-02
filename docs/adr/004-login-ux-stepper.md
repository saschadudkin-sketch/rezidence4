# ADR-004: Login UX — Stepper, Inline Errors, Resend Timer

**Date:** 2026-04-02  
**Status:** Accepted  
**Addresses:** A-05 (Deep Audit 2026-04-02)

## Context

The two-step phone → OTP login had no visual progress indicator. Errors were shown only as toasts (global, disappearing), not inline next to the relevant field. The resend button had no timer, allowing repeated rapid sends. Users repeated actions without understanding the current state.

## Decision

### Step indicator
Added `<div className="login-step">Шаг {step} из 2</div>` — a persistent progress indicator above the form.

### Inline field errors
`phoneError` and `otpError` state variables drive inline `<div className="field-err">` elements rendered directly below each input. Errors clear on the next keystroke.

### Resend countdown timer
`resendIn` state starts at 30 seconds when OTP is sent. The resend button shows `Отправить код повторно через {n}с` and is disabled while counting down. `setInterval` clears on component unmount.

### Metrics events
`emitLoginMetric()` dispatches `rz:login-metric` CustomEvents for observability:
- `send_code_success/rejected/failed`
- `resend_success/rejected/failed`
- `verify_success/rejected/failed`

### AbortController
In-flight requests are cancelled via `AbortController` on re-send to prevent race conditions.

## Consequences

- Users always know which step they are on.
- Field-level errors are associated with the relevant input, not detached toasts.
- Resend spam is prevented client-side.
- Login metrics enable KPI tracking (login success rate, retry rate).
