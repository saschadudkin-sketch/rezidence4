import { env } from './env';

const FALLBACK_BASE_URL = 'http://localhost:3001';
const configuredApiUrl = env.REACT_APP_API_URL;

export const API_BASE_URL = configuredApiUrl || FALLBACK_BASE_URL;
export const API_CONFIG_ERROR =
  env.NODE_ENV === 'production' && !configuredApiUrl
    ? 'API URL не настроен. Обратитесь к администратору.'
    : null;

