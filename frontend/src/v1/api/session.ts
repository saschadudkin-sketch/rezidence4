/**
 * platform-v1 session probe.
 *
 * Hits the platform-v1 /api/v1/auth/me endpoint via the v1Client base.
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
