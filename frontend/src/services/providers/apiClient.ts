/**
 * services/providers/apiClient.js
 * Backward-compatible facade over modular HTTP client implementation.
 */

export {
  apiClient,
  default,
  resetRefreshState,
  _resetApiState,
  _getRetryDelayMs,
  _getRetryDelayWithJitterMs,
} from '../http/apiClient';
