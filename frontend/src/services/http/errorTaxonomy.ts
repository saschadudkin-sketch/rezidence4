export const ERROR_KIND = {
  NETWORK: 'network',
  AUTH: 'auth',
  FORBIDDEN: 'forbidden',
  VALIDATION: 'validation',
  SERVER: 'server',
  UNKNOWN: 'unknown',
} as const;

export function classifyHttpError(status?: number, message?: string) {
  if (!status) return ERROR_KIND.NETWORK;
  if (status === 401) return ERROR_KIND.AUTH;
  if (status === 403) return ERROR_KIND.FORBIDDEN;
  if (status === 400 || status === 422) return ERROR_KIND.VALIDATION;
  if (status >= 500) return ERROR_KIND.SERVER;
  if (message?.toLowerCase().includes('network')) return ERROR_KIND.NETWORK;
  return ERROR_KIND.UNKNOWN;
}
