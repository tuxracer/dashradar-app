import * as Sentry from "@sentry/react";
import { APP_RELEASE } from "@/lib/appRelease";
import {
  recordWebGpuCrash,
  shouldCountWebGpuCrash,
} from "@/lib/backendSafeMode";
import { readPreviousSessionEnd } from "@/lib/crashSentinel";
import { isDoNotTrackEnabled } from "@/lib/doNotTrack";

/**
 * Fraction of traces sampled. Kept at 1.0 everywhere, production included: the
 * app has only a handful of users, so full sampling costs little and dropping
 * any traces would just discard data worth keeping.
 */
const TRACES_SAMPLE_RATE = 1.0;

/**
 * Consume the previous session's crash sentinel, if any, before the DNT gate
 * below so a dirty record is always read and cleared regardless of whether
 * this session reports it. iOS sometimes kills the page mid-scan with no JS
 * running at kill time, so Sentry never sees the crash itself; this is the
 * only chance the NEXT launch gets to notice and report it.
 */
const previousSessionEnd = readPreviousSessionEnd();

/**
 * A same-release crash on the WebGPU backend counts toward the WASM safe
 * mode's crash streak; at SAFE_MODE_CRASH_THRESHOLD consecutive crashes the
 * release's remaining sessions run detection on the CPU instead of the GPU
 * path that (by the strongest available signal) keeps taking the page down.
 * A local stability decision, not telemetry, so it sits outside the DNT gate
 * below.
 */
if (shouldCountWebGpuCrash(previousSessionEnd)) {
  recordWebGpuCrash();
}

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
    release: APP_RELEASE,

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

  // Report a dirty previous session now that Sentry is initialized. Level
  // distinguishes an OS-level kill ("crash", the page relaunched almost
  // immediately) from a longer gap ("unclean": battery death, manual
  // restart, deliberate shutdown), which cannot be told apart from a genuine
  // crash by gap alone but is far less likely to be one.
  if (previousSessionEnd) {
    const {
      outcome,
      gapMs,
      uptimeMs,
      framesProcessed,
      backend,
      graphCapture,
      release,
    } = previousSessionEnd;
    Sentry.captureMessage("Previous session terminated while scanning", {
      level: outcome === "crash" ? "error" : "warning",
      tags: {
        sessionEnd: outcome,
        backend: backend ?? "unknown",
        graphCapture: String(graphCapture ?? "unknown"),
        // The build that wrote the record, versus the event's own release
        // tag (the build reporting it): they differ when a deploy landed
        // between the dirty session and this launch.
        sentinelRelease: release ?? "unknown",
      },
      extra: { gapMs, uptimeMs, framesProcessed },
    });
  }
}
