import * as Sentry from "@sentry/react";
import { APP_RELEASE } from "@/lib/appRelease";
import { readPreviousSessionEnd, uptimeBucket } from "@/lib/crashSentinel";
import { readInstallId } from "@/lib/installId";
import { isTrackingOptedOut } from "privacy-signals";

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
 * Initialize Sentry as a side effect at import time, so instrumentation is in
 * place before the rest of the app's modules load (main.tsx imports this file
 * first). Reporting is skipped entirely when the user has asked not to be
 * tracked: no camera images ever leave the device, and the diagnostics that do
 * honor Do Not Track / Global Privacy Control the same way
 * src/main.tsx already gates Vercel Analytics: only a definitive "not opted
 * out" (=== false) initializes the SDK, since null means the signals could
 * not be read, which is not consent. Dev builds are treated the same as an
 * active opt-out, so a dev session never reports to Sentry either.
 * An empty VITE_SENTRY_DSN also disables the SDK, so a build without it
 * configured stays silent.
 */
if (!import.meta.env.DEV && isTrackingOptedOut() === false) {
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

  // Tag every event with the install it came from. The id is random and means
  // nothing outside this project, but it is what separates one phone crashing
  // five times from five phones crashing once, which the crash sentinel cannot
  // tell apart on its own. Minted here rather than at import time so a visitor
  // who has opted out never has one written.
  const installId = readInstallId();
  if (installId) {
    Sentry.setUser({ id: installId });
  }

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
      graphCapture,
      release,
      activeView,
      model,
    } = previousSessionEnd;
    // Tags are the only part of an event that can be grouped, filtered, and
    // charted, so anything a question gets asked of has to be one. That rules
    // out the raw counts below, which are distinct per session and would each
    // answer for exactly one report; uptime earns a tag through a bucket
    // instead, which is what lets "did crashes move earlier in this build" be
    // a chart rather than a stack of reports opened one at a time.
    Sentry.captureMessage("Previous session terminated while scanning", {
      level: outcome === "crash" ? "error" : "warning",
      tags: {
        sessionEnd: outcome,
        graphCapture: String(graphCapture ?? "unknown"),
        // The build that wrote the record, versus the event's own release
        // tag (the build reporting it): they differ when a deploy landed
        // between the dirty session and this launch.
        sentinelRelease: release ?? "unknown",
        activeView: activeView ?? "unknown",
        model: model ?? "unknown",
        uptimeBucket: uptimeBucket(uptimeMs),
      },
      extra: { gapMs, uptimeMs, framesProcessed },
    });
  }
}
