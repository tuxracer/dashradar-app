/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />
/// <reference types="@webgpu/types" />

/** App version injected at build time from package.json (see vite.config.ts `define`). */
declare const __APP_VERSION__: string;

/**
 * Short (7-char) commit SHA for the build, injected at build time (see
 * vite.config.ts `define`). "unknown" when git/Vercel provided no SHA.
 */
declare const __COMMIT_SHA__: string;
