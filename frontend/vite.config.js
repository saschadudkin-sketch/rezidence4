import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'child_process';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const APP_ROOT = dirname(fileURLToPath(import.meta.url));

// DO-06: Derive release version from git — injected as VITE_APP_VERSION so
// Sentry.init({ release }) gets the exact commit SHA linked to the deployed build.
// Falls back to package.json version when git is unavailable (CI cache, Docker).
function getGitVersion() {
  try {
    const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    let tag = '';
    try {
      tag = execSync('git describe --tags --abbrev=0', {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      tag = '';
    }
    return tag ? `${tag}+${sha}` : sha;
  } catch {
    return process.env.npm_package_version || 'unknown';
  }
}

export default defineConfig(({ mode }) => {
  const viteEnv = loadEnv(mode, APP_ROOT, 'VITE_');
  const isProdBuild = mode === 'production';
  const appVersion = viteEnv.VITE_APP_VERSION || getGitVersion();
  const devApiProxy = viteEnv.VITE_DEV_API_PROXY || viteEnv.VITE_API_URL || '';
  const devApiOrigin = (() => {
    if (!devApiProxy) return '';
    try {
      return new URL(devApiProxy).origin;
    } catch {
      return '';
    }
  })();
  const devConnectSrc = ["'self'", 'ws:', 'wss:'];
  if (devApiOrigin) devConnectSrc.push(devApiOrigin);

  if (isProdBuild && !viteEnv.VITE_API_URL) {
    throw new Error(
      'VITE_API_URL is required for production build.\n' +
      'Run `npm run verify:env` for a preflight checklist and remediation file.'
    );
  }
  if (isProdBuild && !viteEnv.VITE_RUNTIME_MODE) {
    throw new Error(
      'VITE_RUNTIME_MODE is required for production build.\n' +
      'Set VITE_RUNTIME_MODE=live for the production user journey.\n' +
      'Use VITE_RUNTIME_MODE=demo only together with VITE_ENABLE_DEMO=true on internal sandbox builds.\n' +
      'Run `npm run verify:env` for a preflight checklist and remediation file.'
    );
  }
  if (isProdBuild && viteEnv.VITE_RUNTIME_MODE?.trim().toLowerCase() === 'demo' && viteEnv.VITE_ENABLE_DEMO?.trim().toLowerCase() !== 'true') {
    throw new Error(
      'Demo mode is disabled for production builds by default.\n' +
      'Use VITE_RUNTIME_MODE=live for production or set VITE_ENABLE_DEMO=true for an internal sandbox build.\n' +
      'Run `npm run verify:env` for a preflight checklist and remediation file.'
    );
  }

  return {
    root: APP_ROOT,
    envDir: APP_ROOT,
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
      proxy: devApiProxy
        ? {
            '/api': {
              target: devApiProxy,
              changeOrigin: true,
              secure: false,
            },
            '/platform': {
              target: devApiProxy,
              changeOrigin: true,
              secure: false,
            },
          }
        : undefined,
      headers: {
        'Content-Security-Policy': [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Vite HMR requires these in dev
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com",
          "img-src 'self' data: blob:",
          `connect-src ${devConnectSrc.join(' ')}`,
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
        // Two entry points: the tenant SPA (index.html → *.domhub.su) and the
        // superadmin SPA (admin.html → admin.domhub.su).  Nginx picks the right
        // HTML file based on the incoming hostname; shared vendor chunks (React,
        // router) are content-hashed and deduplicated by Rollup automatically.
        input: {
          main: 'index.html',
          admin: 'admin.html',
        },
        output: {
          // Explicit code-split boundaries to keep chunks under budget.
          // PF2: explicit chunk boundaries — keeps initial JS payload small.
          // vendor-react  → react + react-dom (render engine, always needed)
          // vendor-router → react-router packages (route graph, split from renderer)
          // vendor-query  → tanstack query + virtual (loaded with Dashboard chunk)
          // vendor-sentry → error monitoring (async, doesn't block first paint)
          // vendor-qr     → qrcode library (used only in QR modal, smallest chunk)
            manualChunks(id) {
              if (!id.includes('node_modules')) return;
              if (
                id.includes('/react-router-dom/') ||
                id.includes('/react-router/')
              ) return 'vendor-router';
              if (
                id.includes('/react/') ||
                id.includes('/react-dom/') ||
                id.includes('/scheduler/')
              ) return 'vendor-react';
              if (id.includes('@tanstack/react-query')) return 'vendor-query-core';
              if (id.includes('@tanstack/react-virtual')) return 'vendor-query-virtual';
              if (id.includes('@sentry/react')) return 'vendor-sentry';
              if (id.includes('/qrcode/')) return 'vendor-qr';
              if (id.includes('/workbox-') || id.includes('/vite-plugin-pwa/')) return 'vendor-workbox';
              return 'vendor-misc';
            },
        },
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      pool: 'threads',
      maxWorkers: 1,
      setupFiles: './src/setupTests.ts',
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
