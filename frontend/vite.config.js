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
    resolve: {
      extensions: ['.mjs', '.js', '.jsx', '.ts', '.tsx', '.json'],
    },
    esbuild: {
      loader: 'jsx',
      include: /src\/.*\.[jt]sx?$/,
      exclude: [],
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './src/setupTests.js',
      css: true,
      include: ['src/**/*.{test,spec}.{js,jsx,ts,tsx}'],
      deps: {
        optimizer: {
          web: {
            include: ['react', 'react-dom'],
          },
        },
      },
    },
  };
});
