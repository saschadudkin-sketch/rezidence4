import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const viteEnv = loadEnv(mode, process.cwd(), 'VITE_');
  const isProdBuild = mode === 'production';

  if (isProdBuild && !viteEnv.VITE_API_URL) {
    throw new Error('VITE_API_URL is required for production build');
  }
  if (isProdBuild && !viteEnv.VITE_RUNTIME_MODE) {
    throw new Error(
      'VITE_RUNTIME_MODE is required for production build.\n' +
      'Set VITE_RUNTIME_MODE=live to prevent demo credentials from shipping in the bundle.'
    );
  }

  return {
    plugins: [react()],
    resolve: {
      extensions: ['.mjs', '.js', '.jsx', '.ts', '.tsx', '.json'],
    },
    esbuild: {
      loader: 'jsx',
      include: /src\/.*\.[jt]sx?$/,
      exclude: [],
    },
    build: {
      // A-07: bundle budget gates — warn at 300 KB, error at 600 KB per chunk.
      // Run `VITE_API_URL=x npm run build` to check budgets locally.
      chunkSizeWarningLimit: 300,
      rollupOptions: {
        output: {
          // Explicit code-split boundaries to keep chunks under budget.
          manualChunks: {
            'vendor-react': ['react', 'react-dom'],
            'vendor-qr': ['qrcode'],
          },
        },
      },
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
