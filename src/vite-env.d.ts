/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />
/// <reference types="@webgpu/types" />

interface ImportMetaEnv {
  /**
   * Sentry DSN (public client key). Empty or absent disables Sentry. Set in
   * .env.local for local dev and in the hosting environment for production.
   */
  readonly VITE_SENTRY_DSN: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** App version injected at build time from package.json (see vite.config.ts `define`). */
declare const __APP_VERSION__: string;

/**
 * Short (7-char) commit SHA for the build, injected at build time (see
 * vite.config.ts `define`). "unknown" when git/Vercel provided no SHA.
 */
declare const __COMMIT_SHA__: string;

/**
 * URL of the dev video file served by the devVideo plugin (vite.config.ts),
 * or null outside dev-video mode. Always null in production builds.
 */
declare const __DEV_VIDEO_URL__: string | null;
