import * as Sentry from "@sentry/react";
import { APP_RELEASE } from "@/lib/appRelease";
import { readPreviousSessionEnd, uptimeBucket } from "@/lib/crashSentinel";
import { readInstallId } from "@/lib/installId";
import { isTrackingOptedOut } from "privacy-signals";

/** 1.0 everywhere: with a handful of users, sampling would only discard data. */
const TRACES_SAMPLE_RATE = 1.0;

/**
 * Read and clear the previous session's sentinel ahead of the tracking gate, so a
 * dirty record is consumed whether or not this session reports it. An iOS kill
 * runs no JS, so the next launch is the only chance to notice one.
 */
const previousSessionEnd = readPreviousSessionEnd();

// Unconditional, ahead of any reporting gate. A tethered Web Inspector loses the
// dead process's console with it, so this is what puts the tail of that session
// in front of whoever reattaches, and it works where Sentry does not.
if (previousSessionEnd) {
  const { events, ...summary } = previousSessionEnd;
  console.info("[dashradar] previous session ended dirty", summary);
  for (const { at, kind, detail } of events ?? []) {
    console.info(
      `[dashradar] ${new Date(at).toISOString()} ${detail ? `${kind} ${detail}` : kind}`,
    );
  }
}

/**
 * Initialize at import time, before the rest of the app loads. Gated on Do Not
 * Track exactly as analytics is: only a definitive "not opted out" initializes
 * the SDK, since null means the signals were unreadable and is not consent.
 */
if (!import.meta.env.DEV && isTrackingOptedOut() === false) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    release: APP_RELEASE,

    // Session Replay is deliberately left off: it would record the live camera
    // feed and the detections, which must not leave the device.
    integrations: [Sentry.browserTracingIntegration()],

    tracesSampleRate: TRACES_SAMPLE_RATE,
    // tracePropagationTargets stays at its same-origin default: trace headers on
    // the cross-origin model download would trip a CORS preflight and break it
    // under the app's cross-origin-isolation headers.

    // Never attach IP addresses or other PII to events.
    sendDefaultPii: false,
  });

  // A random id meaning nothing outside this project, but what separates one
  // phone crashing five times from five phones crashing once. Minted here rather
  // than at import time so an opted-out visitor never has one written.
  const installId = readInstallId();
  if (installId) {
    Sentry.setUser({ id: installId });
  }

  // Level separates an OS-level kill, where the page relaunched almost
  // immediately, from a longer gap that is far less likely to be a crash.
  if (previousSessionEnd) {
    const {
      outcome,
      gapMs,
      uptimeMs,
      framesProcessed,
      scansProcessed,
      graphCapture,
      release,
      activeView,
      model,
      recycles,
      workerAgeMs,
      ownedBitmaps,
      wasmHeapBytes,
      events,
    } = previousSessionEnd;
    // Before the capture, which is what attaches them to it. Each keeps the time
    // it happened rather than the time it is replayed, so the trail reads against
    // the moment the page died. Sentry takes seconds here.
    for (const { at, kind, detail } of events ?? []) {
      Sentry.addBreadcrumb({
        category: "session",
        level: kind === "error" ? "error" : "info",
        message: detail ? `${kind} ${detail}` : kind,
        timestamp: at / 1_000,
      });
    }
    // Only tags can be grouped, filtered, and charted, so anything a question
    // gets asked of has to be one. That rules out the raw counts below, distinct
    // per session and answering for exactly one report each; uptime earns a tag
    // through a bucket instead.
    Sentry.captureMessage("Previous session terminated while scanning", {
      level: outcome === "crash" ? "error" : "warning",
      tags: {
        sessionEnd: outcome,
        graphCapture: String(graphCapture ?? "unknown"),
        // The build that wrote the record, against the event's own release tag:
        // they differ when a deploy landed between the two launches.
        sentinelRelease: release ?? "unknown",
        activeView: activeView ?? "unknown",
        model: model ?? "unknown",
        uptimeBucket: uptimeBucket(uptimeMs),
        // Bounded in practice, so it can be a tag and answer whether crashes
        // follow a rebuilt worker. The worker's age is a fresh number every
        // session, so it rides along as detail instead.
        recycles: String(recycles ?? "unknown"),
      },
      extra: {
        gapMs,
        uptimeMs,
        framesProcessed,
        scansProcessed,
        workerAgeMs,
        ownedBitmaps,
        wasmHeapBytes,
      },
    });
  }
}
