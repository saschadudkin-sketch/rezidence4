import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

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
    plugins: [
      react(),
      VitePWA({
        // injectManifest — используем существующий public/sw.js как базу,
        // Workbox инжектирует precache-манифест со всеми хешированными ассетами сборки.
        strategies: 'injectManifest',
        srcDir: 'public',
        filename: 'sw.js',
        // В dev SW не регистрируется чтобы не мешать HMR
        devOptions: { enabled: false },
        injectManifest: {
          // Не кешируем API-запросы и загруженные фото
          globIgnores: ['**/api/**', '**/uploads/**'],
        },
        manifest: {
          name: 'Резиденции Замоскворечья',
          short_name: 'Резиденции',
          description: 'Система управления резиденцией',
          theme_color: '#1a1a2e',
          background_color: '#1a1a2e',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '/',
          icons: [
            { src: '/logo192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/logo192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
            { src: '/logo512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: '/logo512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
      }),
    ],
    resolve: {
      extensions: ['.mjs', '.js', '.jsx', '.ts', '.tsx', '.json'],
    },
    esbuild: {
      // loader: 'tsx' handles both TypeScript syntax (interface, type, generics)
      // and JSX — needed for .js files with JSX and .ts files with TS types.
      loader: 'tsx',
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
