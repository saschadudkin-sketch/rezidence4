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

export function useAuthFlow() {
  const { phoneDb } = useUsers();

  const sendOtp = useCallback(async (phone) => {
    if (isLiveMode()) {
      return services.auth.sendOtp(phone);
    }
    // Demo: look up user in local phone directory
    const found = findByPhone(phone, phoneDb);
    if (!found) {
      const err = new Error('Номер не найден в системе');
      err.notFound = true;
      throw err;
    }
    await new Promise(r => setTimeout(r, 600));
    return found; // returned so the caller can cache it
  }, [phoneDb]);

  const verifyOtp = useCallback(async (phone, otp, demoUser) => {
    if (isLiveMode()) {
      return services.auth.verifyOtp(phone, otp);
    }
    // Demo: any 6-digit code is accepted — demoUser was returned by sendOtp
    await new Promise(r => setTimeout(r, 400));
    return demoUser;
  }, []);

  return { sendOtp, verifyOtp };
}
