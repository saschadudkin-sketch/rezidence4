const FALLBACK_BASE_URL = 'http://localhost:3001';
const configuredApiUrl = import.meta?.env?.VITE_API_URL;

export const API_BASE_URL = configuredApiUrl || FALLBACK_BASE_URL;
export const API_CONFIG_ERROR =
  (import.meta?.env?.PROD === true) && !configuredApiUrl
    ? 'API URL не настроен. Обратитесь к администратору.'
    : null;
