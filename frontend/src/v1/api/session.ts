/**
 * platform-v1 session probe.
 *
 * Hits the legacy /api/auth/me endpoint (backend/src/routes/auth.js:365),
 * which is mounted at /api/auth/me (NOT /api/v1/auth/me).  The v1Client base
 * is `/api/v1` — we pass an absolute override via the `path` argument to
 * reach the legacy mount.
 *
 * Response shape:  { user: UserMe }
 * Returned value: the unwrapped UserMe.
 */

import { v1Client, type RequestOpts } from './client';
import type { UserMe } from './types';

export const sessionApi = {
  async me(opts?: RequestOpts): Promise<UserMe> {
    const res = await v1Client.get<{ user: UserMe }>(`/auth/me`, opts);
    return res.user;
  },
};
