# Web Push (VAPID) — Setup Runbook

DomHub uses **pure VAPID web push** per RFC 8291 — no Firebase, no Google Cloud
Messaging project, no third-party push SDK. Browser push messages are sent
directly to the user-agent's push service (Mozilla autopush, Chrome's push
endpoint, Apple Push Notification Service for Safari) using our own VAPID keys.

This keeps personal data (endpoint URLs, encryption keys) on our infrastructure
in Russia — required for **ФЗ-152** compliance.

## Generating VAPID keys (once per deployment)

Keys are a long-lived secret. Generate **once** and store in the deployment's
environment; rotating them invalidates every subscribed device and forces every
resident to re-enable notifications.

```bash
cd backend
node -e "const w=require('web-push');const k=w.generateVAPIDKeys();console.log('VAPID_PUBLIC_KEY='+k.publicKey);console.log('VAPID_PRIVATE_KEY='+k.privateKey)"
```

Expected output:

```
VAPID_PUBLIC_KEY=BHk9sT_...88 chars...
VAPID_PRIVATE_KEY=A2c1...43 chars...
```

## Required environment variables

Set these on the backend (see `backend/.env.example`):

| Variable            | Example                       | Notes                                              |
| ------------------- | ----------------------------- | -------------------------------------------------- |
| `VAPID_PUBLIC_KEY`  | `BHk9sT_...`                  | Served to browsers via `/api/v1/push-subscriptions/vapid-public-key` |
| `VAPID_PRIVATE_KEY` | `A2c1...`                     | Secret. Never commit, never expose                 |
| `VAPID_SUBJECT`     | `mailto:admin@domhub.su`      | Contact identifying the push operator (RFC 8292)   |

If any of the three is missing, the backend logs a warning on startup and
silently disables web push — the app continues working, residents just won't
receive browser notifications.

## Verifying the setup

1. Start the backend. Check logs for:
   ```
   [notify] web-push initialised with VAPID keys
   ```
   If you see `VAPID env vars not set` or `web-push not installed`, fix the
   configuration before continuing.

2. Load the resident app in a browser that supports web push (Chrome, Firefox,
   Edge, Safari 16.4+). Log in as a resident.

3. Browser DevTools → Application → Service Workers: verify `sw.js` is active.

4. Grant the notification permission prompt. In the DevTools Network tab you
   should see:
   - `GET /api/v1/push-subscriptions/vapid-public-key` → 200
   - `POST /api/v1/push-subscriptions` → 201 with `{ subscription: { id: "..." } }`

5. Check the database:
   ```sql
   SELECT id, user_id, device_name, is_active, created_at
     FROM push_subscriptions
     WHERE platform = 'web'
     ORDER BY created_at DESC
     LIMIT 5;
   ```

6. Trigger an event that dispatches a push (e.g. approve the resident's
   request from the admin UI). The resident's browser should show a system
   notification within a few seconds.

## Rotation and revocation

- **Individual device** — the user revokes via the app's notification settings
  (`unsubscribePush()`), which calls `DELETE /api/v1/push-subscriptions/:id`.
- **Dead endpoints** — the backend auto-deactivates subscriptions that return
  410/404 from the push service (e.g. browser uninstalled, user cleared data).
- **Full VAPID rotation** — regenerate keys, restart the backend, truncate
  `push_subscriptions` (or mark all `is_active = false`). Every resident must
  re-subscribe on their next app session. Treat this as a last resort.

## ФЗ-152 notes

- Push endpoints (e.g. `https://fcm.googleapis.com/fcm/send/...`) are **opaque
  transport identifiers**. They are not personal data on their own, but
  combined with `user_id` they become subject persönlichen data rules.
- The `push_subscriptions` table lives in the property's PostgreSQL database,
  which in production is hosted in Russia (Timeweb Cloud, Moscow region).
- No payload content is ever sent to Google / Mozilla / Apple — VAPID encrypts
  payloads end-to-end with the per-subscription `p256dh` + `auth` keys the
  browser supplied us. The push service sees only ciphertext.
- On user account deletion, all rows in `push_subscriptions` for that user
  must be removed as part of the GDPR-delete flow (TODO: wire into the
  deletion endpoint when it lands).
