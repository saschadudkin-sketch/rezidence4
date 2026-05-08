import { resolveRuntimeMode, MODE as runtimeMODE } from './config/runtimeMode';

export const probeMeta = (() => {
  try {
    const env = import.meta.env;
    return {
      env,
      envKeys: env ? Object.keys(env) : null,
      vRuntime: env?.VITE_RUNTIME_MODE,
      runtimeMODE,
      resolved: resolveRuntimeMode(),
      resolvedExplicit: resolveRuntimeMode(env),
    };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
})();
