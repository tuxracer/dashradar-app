import * as Sentry from "@sentry/react";
import { isDoNotTrackEnabled } from "@/lib/doNotTrack";

/**
 * Fraction of traces sampled. Kept at 1.0 everywhere, production included: the
 * app has only a handful of users, so full sampling costs little and dropping
 * any traces would just discard data worth keeping.
 */
const TRACES_SAMPLE_RATE = 1.0;

/**
 * Build-time release identifier tying every event back to the exact deployed
 * build. __APP_VERSION__ and __COMMIT_SHA__ are injected by vite.config.ts.
 */
const RELEASE = `dashradar@${__APP_VERSION__}+${__COMMIT_SHA__}`;

/**
 * Initialize Sentry as a side effect at import time, so instrumentation is in
 * place before the rest of the app's modules load (main.tsx imports this file
 * first). Reporting is skipped entirely when the user has asked not to be
 * tracked: dashradar's principle is that no data leaves the device, so error
 * reporting honors Do Not Track / Global Privacy Control the same way
 * src/main.tsx already gates Vercel Analytics. An empty VITE_SENTRY_DSN also
 * disables the SDK, so a build without it configured stays silent.
 */
if (!isDoNotTrackEnabled()) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    release: RELEASE,

    // Errors plus tracing, the Sentry-recommended baseline. Session Replay is
    // deliberately left off: it would record the live camera feed and
    // detections, which must not leave the device.
    integrations: [Sentry.browserTracingIntegration()],

    tracesSampleRate: TRACES_SAMPLE_RATE,
    // tracePropagationTargets is left at its same-origin default on purpose. The
    // Hugging Face model download is cross-origin, so it never receives
    // sentry-trace/baggage headers, which would otherwise trip a CORS preflight
    // and break the download under the app's cross-origin-isolation headers.

    // Never attach IP addresses or other PII to events.
    sendDefaultPii: false,
  });
}
