import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const loadedEnv = loadEnv(mode, process.cwd(), '');
  const nodeEnv = mode === 'production' ? 'production' : 'development';

  return {
    plugins: [react()],
    define: {
      'process.env': JSON.stringify({
        ...loadedEnv,
        NODE_ENV: nodeEnv,
      }),
    },
  };
});
