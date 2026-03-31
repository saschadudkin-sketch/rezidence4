const processEnv = typeof process !== 'undefined' ? process.env : undefined;
const metaEnv = typeof import.meta !== 'undefined' ? import.meta.env : undefined;

const readEnv = (key) => {
  if (metaEnv && metaEnv[key] != null) return metaEnv[key];
  if (processEnv && processEnv[key] != null) return processEnv[key];
  return undefined;
};

export const env = {
  NODE_ENV: readEnv('NODE_ENV') || readEnv('MODE') || 'development',
  REACT_APP_API_URL: readEnv('REACT_APP_API_URL') || readEnv('VITE_API_URL') || '',
  REACT_APP_RUNTIME_MODE: readEnv('REACT_APP_RUNTIME_MODE') || readEnv('VITE_RUNTIME_MODE') || '',
  REACT_APP_MODE: readEnv('REACT_APP_MODE') || readEnv('VITE_MODE') || '',
};
