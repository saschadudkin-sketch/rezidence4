/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_RUNTIME_MODE?: string;
  readonly VITE_MODE?: string;
  readonly VITE_APP_VERSION?: string;
  readonly PROD?: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const process: {
  env: Record<string, string | undefined>;
};
