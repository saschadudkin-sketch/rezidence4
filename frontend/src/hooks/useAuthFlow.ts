// @ts-check
/**
 * useAuthFlow.js — CQ-01: Abstracts live/demo auth behind a single interface.
 *
 * @typedef {{ sendOtp: (phone: string) => Promise<any>, verifyOtp: (phone: string, otp: string, demoUser?: any) => Promise<any> }} AuthFlow
 */
/**
 *
 * Login.jsx previously had isLiveMode() branches inside sendCode() and verify().
 * This hook encapsulates that branching so Login.jsx only calls:
 *   authFlow.sendOtp(phone)   → resolves on success, throws on failure
 *   authFlow.verifyOtp(phone, otp) → resolves with user, throws on failure
 *
 * Live mode → delegates to services.auth (real backend, JWT cookie)
 * Demo mode → simulates OTP flow using in-memory phoneDb from the store
 */

import { useCallback } from 'react';
import { isLiveMode } from '../config/runtimeMode';
import { services } from '../services/providers/serviceContainer';
import { findByPhone } from '../utils';
import { useUsers } from '../store/AppStore';
import type { AppUser } from '../store/slices/usersSlice';
import type { ServiceAck } from '../services/providers/serviceDtos';

type AuthFlowResult = {
  sendOtp: (phone: string) => Promise<ServiceAck | AppUser | void>;
  verifyOtp: (phone: string, otp: string, demoUser?: AppUser | null) => Promise<AppUser | null>;
};

export function useAuthFlow(): AuthFlowResult {
  const { phoneDb } = useUsers();

  const sendOtp = useCallback(async (phone: string): Promise<ServiceAck | AppUser | void> => {
    if (isLiveMode()) {
      return services.auth.sendOtp(phone);
    }
    // Demo: look up user in local phone directory
    const found = findByPhone(phone, phoneDb) as AppUser | null;
    if (!found) {
      const err = Object.assign(new Error('Номер не найден в системе'), { notFound: true });
      throw err;
    }
    await new Promise(r => setTimeout(r, 600));
    return found; // returned so the caller can cache it
  }, [phoneDb]);

  const verifyOtp = useCallback(async (
    phone: string,
    otp: string,
    demoUser?: AppUser | null,
  ): Promise<AppUser | null> => {
    if (isLiveMode()) {
      return services.auth.verifyOtp(phone, otp);
    }
    // Demo: any 6-digit code is accepted — demoUser was returned by sendOtp
    await new Promise(r => setTimeout(r, 400));
    return demoUser ?? null;
  }, []);

  return { sendOtp, verifyOtp };
}
