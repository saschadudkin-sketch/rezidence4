const FALLBACK_BASE_URL = 'http://localhost:3001';
const RUNTIME_ENV = import.meta.env;
const configuredApiUrl = RUNTIME_ENV.VITE_API_URL;

export const API_BASE_URL = configuredApiUrl || FALLBACK_BASE_URL;
export const API_CONFIG_ERROR =
  (RUNTIME_ENV.PROD === true) && !configuredApiUrl
    ? 'API URL не настроен. Обратитесь к администратору.'
    : null;

export function apiV1Url(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}/api/v1${normalizedPath}`;
}
