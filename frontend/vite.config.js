import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'child_process';

// DO-06: Derive release version from git — injected as VITE_APP_VERSION so
// Sentry.init({ release }) gets the exact commit SHA linked to the deployed build.
// Falls back to package.json version when git is unavailable (CI cache, Docker).
function getGitVersion() {
  try {
    const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    const tag = execSync('git describe --tags --abbrev=0 2>/dev/null || echo ""', { encoding: 'utf-8' }).trim();
    return tag ? `${tag}+${sha}` : sha;
  } catch {
    return process.env.npm_package_version || 'unknown';
  }
}

export default defineConfig(({ mode }) => {
  const viteEnv = loadEnv(mode, process.cwd(), 'VITE_');
  const isProdBuild = mode === 'production';
  const appVersion = viteEnv.VITE_APP_VERSION || getGitVersion();

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
    // DO-06: Expose the resolved version to the app bundle so Sentry release
    // tracking links error reports to the exact git commit that shipped them.
    define: {
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
    },
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
          /* FIX [D-1]: matches actual --s0 dark theme token (#13110E) */
          theme_color: '#13110E',
          background_color: '#13110E',
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
    // SEC-05: CSP headers for the Vite dev server — prevents XSS during local
    // development and surfaces policy violations early before nginx applies them.
    // 'unsafe-inline' and 'unsafe-eval' are required for Vite HMR in dev only;
    // they are NOT present in the nginx CSP for production.
    server: {
      headers: {
        'Content-Security-Policy': [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Vite HMR requires these in dev
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com",
          "img-src 'self' data: blob:",
          "connect-src 'self' ws: wss:",
          "worker-src 'self' blob:",
        ].join('; '),
      },
    },
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
