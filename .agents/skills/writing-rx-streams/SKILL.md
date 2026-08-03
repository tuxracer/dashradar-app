---
name: writing-rx-streams
description: Use when writing or modifying any rxjs stream code - the detection engine, the camera feed, the wake lock, or new reactive code anywhere. Holds the resource and request-reply patterns, the failure-handling rules, and the React boundary conventions the stream modules follow.
---

# Writing rx streams

The stream modules (`src/lib/detectionEngine`, `src/lib/camera`, `src/lib/wakeLock`) follow these rules; hold any new reactive code to them. Each rule earned its place by a bug or a review finding, so treat a violation as a defect even when the code appears to work.

## Resources

**A resource is a stream whose teardown is the release.** Model anything with an acquire/release lifecycle (a lock, a camera, a worker, a clock) as an Observable that acquires on subscribe and releases on unsubscribe, then scope it under whatever should own it. Never expose paired start/stop calls a caller has to hold correctly: the caller that forgets the stop leaks the resource, while a subscription scoped under the owner cannot outlive it. `screenWakeLock`, `cameraFeed`, the engine's `workerSession$`, and its scanning-window resources (`scanClock$`, `crashSentinel$`) are the pattern to copy.

**Teardown releases exactly what its own subscription acquired.** When a teardown touches state it shares with sibling subscriptions (a DOM element, a global), it must guard on having been the one that set it, or an unsubscribe racing a replacement wipes the replacement's work. `cameraFeed` clears `video.srcObject` only when its own stream attached.

**Wrap promise-based platform APIs in a hand-rolled Observable with a cancelled flag**, not `from(promise)`: promise conversion can neither cancel the acquisition nor dispose a resource that resolves after unsubscribe. Every await inside the constructor re-checks the flag before committing the result (the teardown-window rule in CLAUDE.md); `captureFrame` and `cameraFeed` show the shape.

## Request and reply

**Subscribe to the reply before sending the request.** When a stream sends a message and awaits the response, the listener must be in place before the send goes out: merge the reply wait ahead of a deferred send, as the frame pump's `postFrame` does. Correctness must never lean on the reply arriving on a later tick; a synchronous responder is legal, and a guarantee that holds only by scheduling is a race waiting for a refactor.

**Bound every wait on an external responder.** A worker or platform API can go silent without erroring, and an unbounded wait turns that into a permanent, invisible stall. Give the wait a `timeout` routed to a recovery path (the pump's reply watchdog recycles the worker and reports `worker_hung` once per page load), or a comment saying why unbounded is safe here.

**Read the inputs a multi-step operation depends on once, before the first await.** The teardown-window rule says to re-check whether the work is still wanted; this is the other half, and it points the opposite way. When two steps derive from the same input, they have to derive from the same _reading_ of it, or an await between them lets the value change and the halves disagree. The pump reads `settings$` once at the top of `postFrame` because the zoom it crops the capture to and the zoom it declares on the message must match: read separately, a zoom change mid-capture has the worker map boxes back out of a crop it was never told about, which produces confidently wrong boxes rather than an error. Re-check what may cancel; snapshot what must stay consistent.

## Failure

**A retry must observe what it caught.** Never keep a loop alive with a bare `catchError` that discards the error: count it, write it to the debug snapshot, or report it, so a persistent failure looks different from health. The capture retry's `captureFailures` streak (reset on the next success, shown in the debug overlay only while nonzero) is the pattern.

**Terminal failures use the error channel with a typed error**; recoverable ones stay inside the stream. `cameraFeed` errors with a `CameraError` and reports nothing after it, while the pump's capture failures retry without ever erroring the pump.

## React boundary

**React consumes a resource stream once per mount.** Subscribe in a mount-scoped effect and read changing callbacks through refs (see `CameraView`); a subscription keyed on callback identity restarts the resource on any parent render that forgets to memoize, which for the camera means a user-visible stutter and possibly a fresh permission hit.

Components adapt streams, they don't own logic: acquisition, cancellation, and teardown live in the stream module, and the component only forwards events into React. State the engine publishes crosses into React through `useSyncExternalStore` (`DetectionContext`), never through per-event `setState` chains.

## Style

**Prefer the operator that names the intent.** `startWith(x)`, not `merge(of(x), source$)`; `retry({ delay })`, not catchError-into-a-timer. Composing equivalent behavior out of general-purpose parts hides what the code means and turns a linear pipe into a tree the reader has to re-derive; a stream should read top to bottom as one pipeline, with `merge` and friends reserved for genuinely multiple sources.

**Derive state, don't command it.** A stream's on/off comes from combining its inputs (`running$` from `combineLatest` plus `distinctUntilChanged`), never from imperative pause/resume calls; everything scoped to the on-state subscribes under it so the falling edge tears it down. Imperative state alongside the streams needs the bar the frame-pump gotcha in CLAUDE.md sets: if scoping work under the right subscription can express it, it is not allowed to be a flag.

**Extract a shared stream when two pipes filter the same source the same way** (the pump's `detections$`), and keep deliberate non-obvious choices commented where the refactor would land: `running$` says it is cold on purpose, so nobody "fixes" it with `shareReplay`.
