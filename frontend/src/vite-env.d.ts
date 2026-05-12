/// <reference types="vite/client" />

// Without @types/react, the `key` JSX prop is not stripped from component props.
// This global declaration accepts `key` on all JSX elements.
declare namespace JSX {
  interface IntrinsicAttributes {
    key?: string | number | null;
  }
}

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_PROPERTY_SLUG?: string;
  readonly VITE_RUNTIME_MODE?: string;
  readonly VITE_ENABLE_DEMO?: string;
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
