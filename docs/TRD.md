# TRD: dashradar

> Technical Reference Document. See [CLAUDE.md](../CLAUDE.md) for project conventions.

**Status:** Shipped (v1) · **Date:** 2026-07-11 · **Owner:** Derek Petersen

dashradar turns a phone mounted on a car dash into a live "radar" view: a full-screen rear-camera feed with real-time object detection drawn as a clean, automotive-minimal HUD overlay. Detection runs entirely in the browser via a custom RF-DETR ONNX model on raw onnxruntime-web, in a Web Worker, with WebGPU acceleration when available and a quantized WASM fallback otherwise. It is a client-only Vite React SPA, installable as an offline-first PWA. There is no backend, no accounts, and no data leaves the device: no video, frame, or detection is ever sent anywhere.

---

## 1. Goals & Non-Goals

### Goals

- Turn a phone's camera into a live object-detection HUD, useful mounted on a car dash.
- Detection entirely **on-device**, in a **Web Worker** so inference never blocks the video.
- A clean, **automotive-minimal HUD** ("Autopilot" direction): the road view stays uncluttered, position is communicated spatially (the radar strip), words are reserved for what matters.
- **Offline-first**: works with no connection after the model has downloaded once.
- Keep the phone's screen from sleeping while running (Screen Wake Lock).
- **WebGPU when usable, WASM fallback otherwise**, chosen automatically with no user-facing setting.

### Non-Goals (v1)

- No video recording, no on-device history of detections, no audible alerts. (Analytics does receive a single anonymous `police_detected` count per sighting, debounced; it carries nothing that identifies the sighting. See §3 and §4.3.)
- No accounts, sync, or server component of any kind. The only state that persists across reloads is the browser's model-weight cache and a small `localStorage`-backed display-settings object (`dashradar:settings`, e.g. the video-feed toggle). There is no IndexedDB and no history.
- No manual model/backend picker and no nav. Settings are a single full-screen panel (video toggle plus read-only engine/model/about), opened from the top-bar gear.
- No object count in the HUD, no confidence scores shown to the user (used internally for thresholding only).

Success criteria: on a phone with WebGPU, smooth video with boxes updating at several detections per second; on the WASM fallback, box updates slow down but the video itself never stutters; the app works offline after the first launch.

---

## 2. Target Platforms & Device Support

Primary target: a phone mounted in landscape on a car dash, orientation unlocked (the overlay math handles either orientation, see §5). Modern iPhone Safari and Android Chrome are the intended runtime; desktop Chrome/Edge work and are useful for development but are secondary.

| Backend | Chosen when | Model build | Notes |
| --- | --- | --- | --- |
| WebGPU | A GPU adapter **and** device can actually be acquired, and the adapter exposes `shader-f16`: `resolveBackend()` awaits `navigator.gpu.requestAdapter()`, checks `adapter.features.has("shader-f16")`, then awaits `adapter.requestDevice()` (`src/workers/detection/index.ts`) | `model_fp16.onnx` (mixed precision: fp16 weights/compute, GridSample kept fp32, fp32 I/O, ~57 MB) | Faster, and runs with graph capture (§4.1.1) on the native WebGPU EP; the mixed-precision export sidesteps the JSEP fp16 GridSample bug (§4.1); verified end-to-end in Chrome via chrome-devtools MCP |
| WASM | No usable WebGPU: `navigator.gpu` is absent, `requestAdapter`/`requestDevice` returns nothing or throws, or the adapter lacks `shader-f16` | `model_int8.onnx` (int8 dynamic quant, fp32 I/O, ~31 MB) | Universal fallback; the smaller int8 build keeps the CPU path usable |

`resolveBackend()` probes for a real device **before** any weights are downloaded, rather than trusting that `navigator.gpu` merely exists. Some devices expose the API but cannot create a device; trusting the existence check would download the larger fp16 WebGPU build, fail at `InferenceSession.create`, then fall back to downloading the int8 build too. Probing first sends an unusable GPU straight to wasm so only one set of weights is fetched. (`@webgpu/types` provides the ambient WebGPU type declarations, referenced from `src/vite-env.d.ts`.) The webgpu-to-wasm fallback in `loadModel` is kept as a safety net for the rarer case where the probe passes but the session still fails to create.

The `shader-f16` gate is load-bearing for the shipped fp16 build: its fp16 tensors make onnxruntime-web require `shader-f16` at session creation, so requiring it up front keeps the backend choice a two-way split and sends a WebGPU-without-`shader-f16` device (rare on the phones this app targets) down the WASM path instead of failing the session and double-downloading. The debug overlay's `shader-f16` row reports the verdict per device.

No usable WebGPU is not treated as an error: the backend badge in `StatusBar` (`GPU` vs `CPU`) is the only place this is surfaced. There is no manual override.

Real camera video, sustained frame rates against real-world objects, and on-device battery/thermal behavior are verified on-device by the user after merge; jsdom and headless Chrome cannot exercise a real camera or a real driving scene (see §9).

---

## 3. Tech Stack

| Concern | Choice | Notes |
| --- | --- | --- |
| Framework | **Vite 8 (Rolldown)** + **React 19 SPA** | Static client app; `index.html` + `src/main.tsx` entry, no server runtime. |
| Language | **TypeScript** (ESM) | Per repo conventions in `CLAUDE.md`. |
| Detection | **`onnxruntime-web`** | Runs the RF-DETR ONNX model directly via an `InferenceSession`; WebGPU or WASM execution provider. Preprocess and decode are hand-rolled in `src/workers/detection/inference.ts` (no Transformers.js pipeline). See §4 (Model). |
| PWA / offline | **vite-plugin-pwa** (Workbox) | Precaches the app shell; runtime-caches the model weights from Hugging Face and the ONNX runtime's CDN fetch. See §7. |
| Styling | **Tailwind CSS v4** | Utility classes directly on HUD elements; one CSS custom property (`--color-hud-amber`) plus the surface color in `src/globals.css`. |
| UI kit | Bespoke Tailwind-styled elements; `lucide-react` for the settings gear icon | No `src/components/ui/` primitives or shadcn/Radix components; the only icon-library use is the `Settings` and `X` glyphs in `SettingsButton` / `SettingsScreen` (named import, tree-shaken). |
| Fonts | **Rajdhani** | Self-hosted via `@fontsource/rajdhani` (weights 500/600/700), imported in `src/main.tsx`. Only font in the app. |
| Utilities | **remeda** | Type guards (`isString`, `isNumber`, `isPlainObject`) validating worker messages crossing the `postMessage` boundary. |
| Analytics | **`@vercel/analytics`** | `inject()` in `src/main.tsx`. Anonymous events only, never camera frames, detection boxes, or location: page views, UI events (`intro_start`, `settings_open`, `share_click`), health events (`backend_resolved`, `model_ready`, `error`, `pwa_installed`), and a debounced `police_detected` sighting count. See §4.3. |
| Testing | **vitest** + **@testing-library/react** | jsdom environment; the worker, onnxruntime-web inference, and camera are stubbed or injected (see §9). The pure preprocess/decode helpers are unit-tested directly. |

> **Build note:** `package.json` scripts: `pnpm dev` → `vite`, `pnpm build` → `vite build`, `pnpm start` → `vite preview`. `pnpm test` runs vitest. `pnpm check` runs format + lint + typecheck and must pass before commits.

---

## 4. Architecture & Project Structure

Data flow: `src/App.tsx` → `DetectionProvider` (React context, `src/context/DetectionContext`) → a Web Worker (`src/workers/detection`) running the RF-DETR ONNX model on onnxruntime-web → `src/lib/detection`'s road-class filter → `src/lib/detectionTracker`'s coasting flicker smoother → `src/lib/detection`'s HUD shaping. All pure, no React, no DOM.

Chosen approach: worker-based inference. Inference never blocks the UI thread, so video stays at native frame rate even when detection itself runs at a handful of frames per second. (WebCodecs was considered and rejected for weak Safari support.)

Per `CLAUDE.md` module conventions, each module is a **directory** named after its primary export, containing `index.ts(x)` and, as needed, `types.ts`, `consts.ts`, `tests.ts`; `index` re-exports the module's types/consts, except the one deliberate exception noted below.

```
index.html                      # Vite HTML entry; PWA meta tags, description, repo link
src/
  main.tsx                      # Vite entry: fonts, globals.css, Vercel Analytics, mounts <App />, registers the service worker
  App.tsx                       # composes the single screen (RadarScreen) inside <DetectionProvider>
  App.test.tsx                  # top-level smoke test (camera-unavailable path)
  globals.css                   # Tailwind import + HUD design tokens (--color-hud-amber, --color-surface)
  components/
    CameraView/                 # the <video> element; owns getUserMedia lifecycle, reports the element + errors
    RadarBackdrop/              # static radar-grid layer shown behind the feed; the visible background when the video is toggled off
    HudOverlay/                 # nearest-object box (amber when NEAR, white otherwise) + floating tag markers; annotates both with confidence + coords when debug is on; rAF loop applies the motion-compensation transform
    RadarStrip/                 # lane-radar strip: one blip per detection, amber + larger for the nearest-when-NEAR
    RadarDetectorScreen/        # opaque fullscreen radar-detector instrument (the ladder segments as radial ticks on a tachometer-style arc around a percentage readout and SCANNING/ALERT status word, with a scanning sweep, signal-colored glow, and pulsing alert ring; no camera or boxes), driven by a requestAnimationFrame peak-hold/decay loop writing to the DOM; rendered by RadarScreen in place of HudOverlay + RadarStrip when the radarDetectorMode setting is on; the same loop drives the lib/radarAudio beeper (gated by the radarAudio setting); also renders a contact card beside the dial (right side in landscape, docked below it in portrait) from useDetection()'s optional contact prop, canvas-drawing the cutout above a direction row (no label or percent; the dial already carries the number; the row renders only while the raw signal is nonzero, so no stale heading shows while the card lingers through the decay tail); the card's opacity is written by the same rAF loop through a data-contact attribute on the root, so it fades in and out with the peak-held meter and only shows while a contact exists; while the debug prop is on and the contact carries the full inference frame, the card also shows a SAVE button (lib/saveFrame) that downloads that frame as a timestamped JPEG for collecting training data; the card's visibility is delayed-visibility CSS rather than opacity alone, so it stays clickable through the fade-out and only goes untappable once fully invisible
    StatusBar/                  # wordmark + settings gear
    SettingsButton/             # enlarged gear that opens the full-screen settings panel
    SettingsScreen/             # full-screen settings panel: video + debug overlay toggles + engine/model/about + share row
    ShareCard/                  # share row (settings) + ShareQr, the pre-rendered dashradar.app QR code on a white card, reused by the desktop intro
    DebugOverlay/               # top-left diagnostics panel (timing, detection counts, system info, motion delta + pixel offset); shown only when showDebug is on
    ModelLoadScreen/            # download-progress screen (percent + MB), delayed to avoid a flash, shown only for a real network download (not a cache load)
    ErrorScreen/                # full-screen camera/detection error copy + reload action
    StartGate/                  # full-screen iOS tap-to-start gate; shown after opting into stabilizeMotion, requests motion permission from the tap
    IntroScreen/                # full-screen first-open intro (radar-sweep scope, app pitch, START button; on desktop the QR code + a continue link instead); rendered instead of the radar screen until dismissed, persisted under dashradar:introSeen
  context/
    DetectionContext/           # worker lifecycle, frame pump, status machine, motion capture-pose tracking; consume via useDetection()
    SettingsContext/            # display options (showVideo, showDebug, stabilizeMotion, radarDetectorMode, radarAudio) + ephemeral settings-open state; consume via useSettings()
  lib/
    branding/                   # WORDMARK, the uppercase display wordmark shared by StatusBar, ErrorScreen, and the intro eyebrow
    camera/                     # getUserMedia wrapper; typed CameraError; rear-camera constraints
    crashSentinel/              # localStorage heartbeat + next-launch crash/unclean classification for the iOS page-killed-mid-scan case (pure)
    detection/                  # road-class filter, NEAR heuristic, HUD shaping, coordinate mapping (pure)
    detectionTracker/           # coasting flicker smoother between toRoadDetections and buildHudModel: greedy IoU matching, show-immediately, coast-on-miss (pure step function + stateful factory)
    deviceType/                 # isDesktopDevice: fine hover-capable pointer media query; mobile when matchMedia is unavailable
    motionSensor/               # devicemotion rotationRate integration into yaw/pitch, iOS permission handling (pure)
    pwaInstall/                 # trackPwaInstall: one-time pwa_installed analytics event via appinstalled (Chromium) + first standalone launch (iOS), deduped by a localStorage flag
    radarSignal/                # React-free math for the radar-detector meter: hudSignal (max police score across the HUD, remapped from the [SIGNAL_FLOOR, 1] score band onto [0, 1]), decayPeak (peak-hold + decay step), litSegments, signalColor (green to amber to red ramp), signalFromScore (the shared score-to-[0,1]-signal remap hudSignal delegates to, also stored on the contact cutout as its signal), and contactDirection (which third of the frame a detection's box center falls in; image-left is the driver's left), plus tuning consts SEGMENT_COUNT, DECAY_PER_SEC, SIGNAL_FLOOR, DIRECTION_LEFT_MAX, DIRECTION_RIGHT_MIN
    radarAudio/                 # React-free Web Audio beeper for radar-detector mode: createRadarBeeper (one persistent square-wave oscillator; short self-terminating beeps that pulse faster and higher-pitched as the signal climbs, silence when nothing is detected, disposed on mode exit) plus pure beepIntervalMs/beepFrequencyHz helpers; the AudioContext is created lazily on the first audible signal and unlocked from the next user gesture when autoplay policy suspends it
    saveFrame/                  # React-free download helpers for debug-mode frame saving: frameFilename (local-time dashradar-frame-YYYY-MM-DD-HHMMSS.jpg naming) and downloadBlob (object-URL anchor download)
    serviceWorker/              # waitForServiceWorkerControl (defer model load until the SW controls the page) + requestPersistentStorage
    wakeLock/                   # Screen Wake Lock acquire/release with visibilitychange re-acquire
  types/
    index.ts                    # RawDetection, NormalizedBox, Detection, RoadCategory + type guards
  workers/
    detection/                  # the Web Worker: downloads the ONNX model, runs inference (index.ts), pure preprocess/decode (inference.ts), model URLs + normalization consts (consts.ts), typed message protocol (types.ts)
  vite-env.d.ts
public/
  icon.svg, icon-maskable.svg, icon-192.png, icon-512.png,
  icon-maskable-512.png, apple-touch-icon.png   # radar-motif PWA icons; see §7 for regeneration
```

State is shared via **React Context** rather than prop drilling (`CLAUDE.md`). Constants are named (no magic numbers); numeric literals ≥ 1000 use underscore separators.

### `DetectionContext` / `useDetection()`

```ts
type DetectionStatus = "loading-model" | "ready" | "running" | "error";

type DetectionContextValue = {
  status: DetectionStatus;
  backend: DetectionBackend | undefined;   // "webgpu" | "wasm", set once the model is ready
  downloadingModel: boolean;                // true only while weights stream over the network, not on a cache load
  modelProgress: ModelProgress;             // { loadedBytes, totalBytes }, summed across files
  hud: HudModel | undefined;                // latest shaped detections for the UI to render
  getFps: () => number;                     // rolling detection-result rate, read from a ref on demand
  getDebugSnapshot: () => DebugSnapshot;    // per-frame timing + detection counts, read from a ref on demand
  error: DetectionErrorCode | undefined;
  contact: Contact | undefined;             // latest detection cutout for radar-detector mode's contact card
  start: (video: HTMLVideoElement) => void;
  stop: () => void;
  getMotionDelta: () => YawPitch;           // live yaw/pitch delta (radians) since the displayed detection's capture pose
  motionPermission: MotionPermission;       // "unsupported" | "prompt" | "granted" | "denied"
  requestMotionPermission: () => Promise<void>;
};
```

`DebugSnapshot` (`src/context/DetectionContext/types.ts`) combines the worker's per-frame `FrameTiming` (`preprocessMs`, `inferenceMs`, `decodeMs`) with timing the context measures itself (`captureMs`, the time to capture the video frame into an `ImageBitmap`; `roundTripMs`, wall time from posting a frame to receiving its result) plus `rawCount`/`filteredCount`/`shownCount` (detections as decoded by the worker, after `toRoadDetections`, and after the `detectionTracker` coasting smoother, in that order; see §5), `overheadMs` (round-trip time not spent in the worker's three stages: postMessage delivery each way plus scheduling, clamped at 0), and `pacingDelayMs`/`pacingRule` (the idle delay `schedulePacedFrame` scheduled after the result and whether the absolute floor or the proportional rest set it, rendered as the overlay's `pacing` row). It updates on every `detections` reply regardless of whether `showDebug` is on, so toggling the overlay shows current numbers immediately rather than stale ones. Both the snapshot and the fps reading live in refs read through `getFps()`/`getDebugSnapshot()`, not React state: nothing renders them by default (the debug overlay is hidden), so per-result state updates would re-render every context consumer for values nobody is showing. `DebugOverlay`, the only consumer of either reader, polls both on its ~8 Hz readout tick.

`contact` (`Contact`, `src/context/DetectionContext/types.ts`) is the latest detection cutout: the cropped `ImageBitmap` carried on the worker's `crop` field (see Worker protocol below), the detection's raw `score`, `signal` (the score remapped through `signalFromScore`, the same semantic as the dial readout; not currently rendered on the card), `box`, `direction` (`contactDirection`, which third of the frame the box center falls in), an optional `frame` (a `Blob`), and `at` (`performance.now()` when the reply arrived). A `detections` reply carrying a `crop` replaces `contact` and closes the previous bitmap (`replaceContact`); a detection-free frame leaves `contact` untouched, so radar-detector mode's contact card lingers through the meter's decay tail instead of vanishing the instant police drop out of frame. A crop paired with a detection that fails `toRoadDetections`'s validation (mirroring the road filter) is closed and discarded rather than shown. `contact` is cleared, closing its bitmap, on a `worker-error`/`onerror` and on provider teardown.

`frame`, when present, is the full inference frame the crop was cut from, JPEG-encoded by the worker for debug-mode frame saving (see Worker protocol below); it carries no `close()` lifecycle of its own, unlike the crop bitmap, and is left for garbage collection. `DetectionProvider` reads `useSettings().showDebug`, mirrors it into a ref so `sendFrame` can read the current value without resubscribing, and sends `includeFrame: true` with every `detect` request while it's on; this is why `App.tsx` renders `DetectionProvider` inside `SettingsProvider` rather than the other way around. `RadarDetectorScreen`'s contact card shows a SAVE button, downloading `frame` as a timestamped JPEG via `src/lib/saveFrame`, only while its `debug` prop is on and `frame` is present.

`getMotionDelta()` reports the live camera rotation since the pose the currently displayed detection was captured at. `sendFrame` (see the frame-pump steps below) snapshots the motion sensor's yaw/pitch, a copy taken at the instant a frame is captured, into `captureOrientationRef`. When that frame's `detections` reply arrives, the snapshot is promoted to `referenceOrientationRef`, the pose the displayed boxes were computed from. `getMotionDelta()` subtracts that reference pose from the sensor's live yaw/pitch and returns the difference in radians. `HudOverlay` polls it every animation frame while motion stabilization is on; `DebugOverlay` polls it on its own loop, throttled to about 8 Hz since its readout is only for eyeballing, and scheduled only while `showDebug` is on so a hidden overlay costs nothing. Because only one frame is ever in flight (the frame-pump invariant below), a single capture ref is enough: there is never a second in-flight frame whose pose would need tracking separately.

**Crash sentinel heartbeat** (`src/lib/crashSentinel`). iOS sometimes kills the page mid-scan (a jetsam event); no JS runs at kill time, so Sentry never observes it directly. A `framesTotalRef` counter increments once per `detections` message (in the handler body, never a `setState` updater). A separate effect keyed on `[status]` alone writes a heartbeat (`writeHeartbeat`) to localStorage the instant `status` becomes `"running"` and every `HEARTBEAT_INTERVAL_MS` after (5 s), recording `startedAt`, `lastBeatAt`, `framesProcessed` (relative to a baseline captured when the effect starts), `backend`, and `graphCapture`; its cleanup clears the record (`clearSentinel`). `backend` and `graphCapture` are read from mirror refs inside the interval rather than being effect deps, so the periodic worker recycle (which re-posts `backend-probe`) can't tear the effect down and restart it, which would reset `startedAt` and the frames baseline mid-session and destroy the uptime the sentinel exists to collect. Because the pump already leaves `"running"` on page-hidden, settings-open, and user `stop()`, every normal exit clears the sentinel by construction, leaving a stale record behind only when the OS kills the page outright. At the next launch, `readPreviousSessionEnd()` (called once at the top of `src/instrument.ts`, before Sentry initializes and outside the Do Not Track gate so the record is always consumed) reads and removes the stored record and classifies it: a gap since the last heartbeat within `CRASH_RELAUNCH_WINDOW_MS` (60 s) is a `"crash"` (iOS auto-relaunches a killed foreground tab within seconds), a longer gap is `"unclean"` (battery death, manual restart, deliberate shutdown). A non-empty result is reported via `Sentry.captureMessage("Previous session terminated while scanning")` inside the DNT gate, with `level` `"error"`/`"warning"` for crash/unclean, `tags: { sessionEnd, backend, graphCapture }`, and `extra: { gapMs, uptimeMs, framesProcessed }`.

Status transitions: the provider posts `{ type: "load" }` to the worker once, regardless of whether `start()` has been called yet. In production the load message is deferred until a service worker controls the page (`waitForServiceWorkerControl`, `src/lib/serviceWorker`, bounded by `SW_CONTROL_TIMEOUT_MS`) so the first-visit model download flows through Workbox's runtime cache instead of racing ahead of it (see §7); in dev, which has no service worker, it posts immediately. `loading-model → ready` happens when the worker replies `ready` and `start()` hasn't run; `loading-model → running` (skipping `ready`) happens when the worker replies `ready` and `start()` already ran. `ready → running` happens on `start()`. `running → ready` happens on `stop()`. Any worker error or worker crash moves to `error` from any state; there is no in-app path back out of `error`. `ErrorScreen`'s "TRY AGAIN" button does a full `window.location.reload()`.

### Detection loop (frame pump)

1. `App`'s `RadarScreen` calls `start(video)` once `CameraView` reports a live `<video>` element.
2. The pump (`sendFrame`, in `DetectionContext`) bails if detection isn't running, there's no video/worker, the current worker hasn't reported `ready` yet (`workerLoadedRef`, false from spawn until the ready message, so a frame is never posted to a model-less worker mid-recycle), or a frame is already in flight (`inFlightRef.current > 0`). Otherwise it waits for the camera to present a new frame (`waitForNextVideoFrame` in `src/lib/camera`, built on `video.requestVideoFrameCallback`; resolves immediately on browsers without rVFC), re-checks the guards (the wait can outlive a `stop()`, and rVFC never fires while the page is hidden), then captures `createImageBitmap(video)`, snapshots the motion sensor's current yaw/pitch into `captureOrientationRef` (see below), increments `inFlightRef`, and posts `{ type: "detect", frame, includeFrame }` with the bitmap **transferred** (zero-copy) to the worker; `includeFrame` mirrors the `showDebug` setting (read from a ref so the pump doesn't resubscribe on toggle), asking the worker to also return the full frame for debug-mode saving. Gating the capture on a new camera frame guarantees inference never runs twice on the same frame, even if the detection rate outpaces the camera (e.g. very low light dropping the camera's frame rate below the pacing floor).
3. The worker draws the bitmap onto a 512x512 `OffscreenCanvas`, reads back `ImageData`, and `preprocess`es it (`src/workers/detection/inference.ts`) into the model's `[1,3,512,512]` NCHW ImageNet-normalized float32 input tensor. It runs `session.run`, then `decodeDetections` applies a per-query sigmoid, thresholds at `CONFIDENCE_THRESHOLD`, and converts the cxcywh boxes to normalized xyxy `RawDetection[]`. The bitmap is `close()`d in a `finally` regardless of outcome.
4. On the `detections` reply, `DetectionContext` decrements `inFlightRef`, promotes `captureOrientationRef` to `referenceOrientationRef` (the pose `getMotionDelta()` measures against, since these boxes were computed from a frame taken at that pose), runs `toRoadDetections` (`src/lib/detection`), passes the result through the `detectionTracker` coasting smoother (§5), then `buildHudModel` (`src/lib/detection`) to produce the `HudModel` the UI renders, records a result timestamp for the FPS estimate, and either recycles the worker (§6a) or re-primes the pump via `schedulePacedFrame`.
5. **Backpressure**: only one frame is ever in flight; the next capture is sent only once the previous result returns (latest-wins, no queue), so detection never runs faster than the device can sustain and never blocks the video element.
6. **Pacing**: `schedulePacedFrame` keeps captures at least `MIN_FRAME_INTERVAL_MS` (1000 ms, so detection runs at most once per second) apart and always rests at least `PACING_REST_RATIO` (0.5) of the last result's round trip before the next capture. The interval between captures is therefore `max(1000 ms, 1.5 x round trip)`. On devices whose round trip is under about two thirds of the floor, the floor dominates: the result schedules the next capture on a timeout for the remainder of the second, so the GPU idles between frames rather than running inference back-to-back and thermal-throttling a dash-mounted phone. On slower devices the rest ratio takes over: a 1.2 s round trip is followed by at least 600 ms of idle, capping the inference duty cycle at roughly two thirds instead of letting slow phones run the GPU flat out (which compounds, since sustained throttling makes inference slower still). The coasting tracker and motion stabilization cover the gaps between results. The pacing timer is cleared on `stop()`, worker errors, and provider teardown so a stale timer can't pump a stopped session.
6a. **Periodic recycle**: `workerCreatedAtRef` records `performance.now()` when each worker is created. On a `detections` reply where the pump is running and the worker has been alive at least `WORKER_RECYCLE_AFTER_MS` (900 000 ms, 15 min), step 4 recycles the worker instead of pacing the next frame: it terminates the old worker, bumps `pumpGenerationRef`, resets `inFlightRef` to 0, clears the retry and pace timers, and spawns and loads a fresh worker through the same `spawnWorker`/`requestLoad` helpers used at mount (on a recycle the service worker already controls the page, so the deferred load resolves immediately). This runs at a result boundary where nothing is in flight, so no frame is lost; `status` stays `running` and the new worker's `ready` re-primes the pump through its normal handler (`runningRef` is true). Recycling bounds native memory that JS cannot observe or free (ORT arenas, GPU buffer pools, WASM heap) and grows over thousands of runs until iOS kills the page near its memory cap, the primary crash mitigation for multi-hour scanning sessions. The recycled worker's weights load from CacheStorage (`fromCache: true`), so no download UI flashes; if the cache was evicted, the normal download-progress UI showing is correct. A `readyTrackedRef` guard fires the one-time `backend_resolved`/`model_ready` analytics only on the first `ready` of the page load, so a recycle every 15 minutes does not re-fire them (§4.3).
7. If `createImageBitmap` throws (the video has no frame data yet, e.g. right after attaching), the pump retries after `FRAME_RETRY_MS` (100 ms).
8. `stop()` sets a "not running" flag and bumps a generation counter (`pumpGenerationRef`), so a `createImageBitmap()` capture still in flight from before the stop discards its frame instead of posting it, checked against the captured generation after the `await`.
9. **Visibility pause**: a `visibilitychange` listener in `DetectionProvider` calls `stop()` when the page goes hidden while running (rAF loops throttle on their own in the background, but the pump is result-driven and would otherwise keep capturing and running inference until the OS freezes the tab) and `start()`s again with the same video element when the page returns. A `pausedByVisibilityRef` flag restricts the resume to sessions the handler itself paused, so a visibility bounce never starts a pump the user hadn't started.
10. **Settings pause**: an effect watching the `settingsOpen` setting does the same when the full-screen settings panel opens and closes. The panel is a same-page overlay, so it never fires `visibilitychange`; without this the pump would keep running behind it. A separate `pausedBySettingsRef` flag mirrors the visibility flag (so closing the panel only resumes a session this effect paused, e.g. not one still on the model-load screen), and a `runningRef` guard makes the pause idempotent when the effect re-runs while the panel is open. The two pausers compose: opening settings stops the pump, so a later `visibilitychange` sees it already stopped and leaves the settings pause to own the resume.
11. FPS is a rolling average over the last `FPS_SAMPLE_SIZE` (10) result timestamps; a same-millisecond pair of results is skipped rather than producing a divide-by-zero reading.

These invariants (one frame in flight, the generation guard, and keeping frame-sending out of `setState` updater functions so React StrictMode's double-invocation can't double-pump) are hard-won race fixes; see `CLAUDE.md`'s Gotchas before touching this code.

### Worker protocol (`src/workers/detection/types.ts`)

`WorkerRequest` (main thread → worker):

| Message | Payload | Purpose |
| --- | --- | --- |
| `load` | none | Download the ONNX weights and create the `InferenceSession`; posted once, deferred until the service worker controls the page in production (see §7) |
| `detect` | `frame: ImageBitmap` (transferred), `includeFrame?: boolean` | Run one frame through the model; `includeFrame` asks for the full frame back on the response for debug-mode saving |

`WorkerResponse` (worker → main thread):

| Message | Payload | Purpose |
| --- | --- | --- |
| `model-load-start` | `fromCache: boolean` | Sent once per backend attempt before the weights are read, `fromCache: true` when `caches.match` finds them in the `"model-cache"` route. `DetectionContext` sets `downloadingModel` to `!fromCache` so the download-progress screen shows only for an actual network download, not the fast cache read (which still spends a beat compiling the ONNX session) |
| `model-progress` | `progress: { file, loaded, total }` | One tick per streamed chunk while `fetchModel` downloads the weights (byte counts from the `Content-Length` header); `DetectionContext` sums into a single `ModelProgress`. Not sent on a cache hit, since the bytes are read from CacheStorage in one shot with no download to report |
| `backend-probe` | `probe: BackendProbe` | Sent once alongside `ready` (or the load failure): how far the WebGPU probe got (`workerGpu`/`adapter`/`device`/`shaderF16`), the chosen backend, the WebGPU session error if it fell back, graph-capture state (`graphCapture`/`graphCaptureError`, §4.1.1), `crossOriginIsolated`, and the configured WASM thread count. Feeds the debug overlay only |
| `ready` | `backend: "webgpu" \| "wasm"` | Session finished loading; starts the frame pump immediately if `start()` already ran, otherwise moves to `"ready"` |
| `detections` | `detections: RawDetection[]`, `timing: { preprocessMs, inferenceMs, decodeMs }`, `crop?: { image: ImageBitmap, detectionIndex: number }`, `frame?: Blob` | Decoded output for one frame, boxes normalized 0-1 (xyxy), the worker's own per-stage timing for the debug overlay, an optional cutout of the frame's highest-scoring detection, and an optional JPEG of the full frame when the request set `includeFrame` |
| `worker-error` | `code: DetectionErrorCode` | `MODEL_LOAD_FAILED` from the download or session creation failing, or `INFERENCE_FAILED` from a per-frame inference failure |

`WORKER_CRASHED` is a third `DetectionErrorCode` value, but the worker never posts it as a `worker-error` message: it's set directly by `DetectionContext`'s `worker.onerror` handler on the main thread, for an uncaught exception in the worker that its own try/catch didn't handle.

`crop`, when present, is a cutout of the frame's highest-scoring detection (`topDetectionIndex`), the evidence radar-detector mode's contact card shows. `cropRect` (`src/workers/detection/inference.ts`) pads the detection's box by `CROP_PADDING` (15%) per side for context, clamps to the frame, and downscales, never upscales, so the long edge is at most `CROP_MAX_EDGE` (320px); the resulting `ImageBitmap` is cut from the exact frame inference ran on and **transferred**, not cloned, alongside the rest of the message. `detectionIndex` points back into that same message's `detections` array so the receiver can pair the crop with its score and box. Cropping is best-effort: a degenerate rect (under a pixel on either axis) or a `createImageBitmap` failure just omits `crop` from the message rather than failing the whole detection result.

`frame`, when present, is the full inference frame encoded as JPEG (`FRAME_JPEG_QUALITY` 0.92, `OffscreenCanvas.convertToBlob`), for debug-mode frame saving. `encodeFrame` (`src/workers/detection/index.ts`) draws the frame onto a fresh `OffscreenCanvas` sized to match it and encodes that canvas; the worker only calls it when the request set `includeFrame` and `topDetectionIndex` found a top detection, the same gate that decides whether `crop` is attempted, so the two are always cut from the same frame and detection. Best-effort like the crop: an encode failure just omits `frame` from the message. Unlike `crop`, `frame` is a `Blob` and is sent structured-cloned rather than transferred, since only the crop bitmap needs the zero-copy handoff. The encode happens inline within the same `detect` call, so round-trip timings reported with debug on include it whenever `includeFrame` is set.

Every message crossing the boundary is validated by a type guard (`isWorkerRequest`, `isWorkerResponse`) before being trusted; a malformed message is silently ignored rather than crashing either side.

### Model (`src/workers/detection`)

The detection model is a custom **RF-DETR Small** checkpoint fine-tuned to detect Las Vegas Metro police vehicles, published as ONNX at [`tuxracer/las-vegas-metro-rfdetr-small-t1`](https://huggingface.co/tuxracer/las-vegas-metro-rfdetr-small-t1) and trained/exported from the sibling repo `~/Development/las-vegas-metro-rfdetr-small-t1` (its `CLAUDE.md` documents the export and quantization recipes). `MODEL_URL_BY_BACKEND` (`consts.ts`) streams `onnx/model_fp16.onnx` (mixed precision, ~57 MB) on WebGPU and `onnx/model_int8.onnx` (~31 MB) on WASM, directly from Hugging Face at runtime. All builds share one signature:

- **Input** `input`: `[1,3,512,512]` fp32 NCHW. Fixed 512x512, ImageNet-normalized (`mean=[0.485,0.456,0.406]`, `std=[0.229,0.224,0.225]`), bilinear resize.
- **Output** `dets`: `[1,300,4]` fp32, boxes in cxcywh normalized 0..1.
- **Output** `labels`: `[1,300,2]` fp32, raw class logits (apply sigmoid).

Why raw onnxruntime-web and not the Transformers.js `pipeline("object-detection")`: this checkpoint's head is a single real class scored with a per-query **sigmoid**, with the police class at index 1 (index 0 unused). Transformers.js decodes `rf_detr` with the RT-DETR post-processor (softmax + "last class index is background, skip it"), which drops every real detection, and `RfDetrImageProcessor` isn't a registered JS processor type. So the worker bypasses the pipeline entirely: it does its own ImageNet preprocess and its own sigmoid + cxcywh decode (`inference.ts`). No NMS is applied (RF-DETR is set-based). The graph's output names are read from the session at load time, falling back to the expected `dets`/`labels` if the graph doesn't expose them literally.

### 4.1 WebGPU serves the mixed-precision fp16 build (GridSample stays fp32)

RF-DETR's decoder samples multi-scale features through `GridSample` (3 nodes in this graph), and GridSample precision is the constraint that shaped the WebGPU model choice. The JSEP WebGPU GridSample kernel (the root `onnxruntime-web` import's implementation) generates **invalid WGSL for fp16 tensors**: it emits an `f32 * f16` multiply, which WGSL forbids (no implicit mixed precision), so `CreateShaderModule("GridSample")` fails, the compute pipeline is invalid, and the op silently produces garbage. Because GridSample feeds the decoder, a pure-fp16 build yields broken detections on **every** WebGPU device under JSEP, which is why this app originally served the full-precision fp32 build there (verified at the time: thousands of `Invalid ComputePipeline "GridSample"` errors with fp16, zero with fp32).

Two later changes made fp16 shippable, and it is now what `MODEL_URL_BY_BACKEND` serves on WebGPU. The model repo's v1.5+ `model_fp16.onnx` is a **mixed-precision** export: fp16 weights and compute with the three GridSample nodes kept fp32 behind boundary Casts (GridSample has no weights, so this costs nothing in size), fp32 I/O. And the worker moved to the native C++ WebGPU EP (`onnxruntime-web/webgpu`, §4.1.1), a separate kernel implementation from JSEP. Verified in Chrome via chrome-devtools MCP on the shipped v1.6 build: zero GridSample/WGSL errors, graph capture on, reference-image top score 0.7635 vs the fp32 build's 0.763 (boxes within 0.0001), replay ~20 vs ~25 ms/frame on the same desktop GPU, at half the download (~57 vs ~114 MB). The fp16 build's tensors make onnxruntime-web require the `shader-f16` adapter feature at session creation; `resolveBackend()` gates on it (§2) so unsupported devices go to WASM instead of failing. If a future export changes GridSample precision or the webgpu URL moves to a different build, re-run the verification pass (zero GridSample errors in a real Chrome run, reference-image score matching) before shipping.

### 4.1.1 WebGPU graph capture (on, native WebGPU EP required)

onnxruntime-web's graph capture (`enableGraphCapture: true`) records the model's kernel dispatches on the first run and replays them on later runs, cutting the per-frame CPU overhead of dispatching RF-DETR's hundreds of small kernels (~35 vs ~66 ms/frame in our desktop-GPU verification). It is on via the `WEBGPU_GRAPH_CAPTURE` flag (`consts.ts`):

- `createCaptureModel` creates the session with `enableGraphCapture: true` and `preferredOutputLocation: "gpu-buffer"`. A capture session rejects CPU-located IO at `run()`, so the input lives in one persistent `GPUBuffer` (created on the device from `await env.webgpu.device` after session creation, wrapped once via `Tensor.fromGpuBuffer`) written each frame with `device.queue.writeBuffer`, and outputs are read back with `await tensor.getData(true)`.
- A validation-plus-warm-up run happens at load time, on the still-zeroed input buffer. This performs the actual capture, compiles shaders before the first camera frame, and surfaces run-time capture incompatibility (which does not always fail at session creation) while the weights are still in scope, so falling back to a plain WebGPU session is cheap. The fallback stays: capture is unproven on mobile GPUs, and a device where it fails falls back and keeps working.
- The outcome is reported through the backend probe's `graphCapture`/`graphCaptureError` fields and shown in the debug overlay's "graph capture" row (`on`, `failed` plus an error block, `disabled`, or `n/a` on wasm).

Capture requires every graph node partitioned onto the WebGPU EP, and that is why the worker imports `onnxruntime-web/webgpu` instead of the root `onnxruntime-web`. onnxruntime-web 1.27 ships two WebGPU implementations: the root import runs WebGPU via JSEP (TypeScript kernels, `jsep` runtime files), whose kernel registry has no `TopK`; this graph's TopK node is the model's two-stage proposal selection (ReduceMax over the anchor logits, TopK 300, GatherElements seeding the decoder queries), it is staying in the export, and under JSEP it lands on the CPU EP, failing capture deterministically on every device (`... not been partitioned to the JsExecutionProvider`). The `/webgpu` subpath runs the native C++ WebGPU EP (`asyncify` runtime files), which has a TopK kernel; there, capture initializes and replays correctly. Verified in Chrome via chrome-devtools MCP on both the v1.6 fp32 build and the shipped v1.6 fp16 build (§4.1): overlay reads "graph capture: on", zero GridSample/WGSL errors, reference-image top scores 0.763 (fp32) and 0.7635 (fp16) against the model repo's native baseline 0.7635; the same bundle's WASM EP runs `model_int8.onnx` correctly (top score 0.763, boxes matching to under 0.001), so the one import covers both backends. Two operational notes: a residual `Some nodes were not assigned to the preferred execution providers` warning still prints on the native EP and is harmless, and small numeric drift versus old JSEP results (~0.002 confidence, identical boxes) is expected, not a regression. `ORT_RUNTIME_FILES` in `vite.config.ts` must list the asyncify files while the worker uses the `/webgpu` import (§7).

### 4.2 Motion compensation (`src/lib/motionSensor`)

RF-DETR's detection results land at a handful of frames per second, well below the video's native frame rate. Between results, a driver panning the phone across the road leaves the last-known box lagging behind the object it belongs to. Motion compensation offsets the displayed box by how much the camera has rotated since that box's frame was captured, so it tracks the object between detection results instead of jumping to a new position each time a result arrives.

`src/lib/motionSensor` is React-free and pure gyro, no magnetometer, so it is unaffected by a metal car cabin's magnetic interference. `createMotionSensorManager()` integrates `devicemotion`'s `rotationRate` into a running yaw/pitch orientation using real elapsed time (`integrateYawPitch`), after remapping the event's device-frame `alpha`/`beta`/`gamma` axes to the screen frame via `screen.orientation.angle` (`mapRotationRateToScreen`); `devicemotion`'s axes are fixed to the device's portrait orientation regardless of how the page is displayed, so this remap is required for a phone held in landscape. The manager exposes `start`/`stop`/`getYawPitch`/`getPermission`/`requestPermission`.

iOS gates `devicemotion` behind `DeviceMotionEvent.requestPermission()`, which must be called from a user gesture and offers no way to query whether it was already granted on a prior visit. `createMotionSensorManager` persists a `dashradar:motionGranted` localStorage flag once permission is granted, and `getPermission()` checks it so a return visit skips the prompt; the gyro integration itself starts on mount regardless of permission state, it simply receives no events until permission is granted. `StartGate` (`src/components/StartGate`) is a full-screen tap-to-start overlay shown only after the user turns on the `stabilizeMotion` setting, while `motionPermission === "prompt"` (`shouldShowStartGate`), and only when the settings panel is closed; the tap supplies the gesture iOS requires. It never appears on Android or desktop, where `DeviceMotionEvent.requestPermission` doesn't exist and `getPermission()` returns `"granted"` immediately, nor on a return visit after a prior grant.

`HudOverlay` applies the compensation outside React's render path: a persistent `requestAnimationFrame` loop, independent of the detection-result rate, reads `getMotionDelta()` every animation frame and converts the yaw/pitch delta to a pixel offset (`orientationDeltaToPixels`, which uses the same cover-scaled displayed-video dimensions as `mapBoxToViewport`, via the shared `coverScale` helper), then writes `transform: translate(dx,dy)` directly onto the overlay container's DOM node. The `stabilizeMotion` setting (off by default) gates this through `HudOverlay`'s `stabilize` prop: the loop is only scheduled while it is on; turning it off resets the transform to zero once and stops the loop, so the default configuration runs no per-frame style writes and boxes stay fixed to the screen. Compensation is rotation-only (yaw and pitch, i.e. pan and tilt), not translation. Boxes are never dropped early: the overlay container is `overflow-hidden`, so a pan large enough to carry a box past the viewport edge just slides it out of view rather than the code hiding it preemptively; the next detection result re-centers everything.

The pixel conversion needs a camera field of view the Web platform does not expose, so `ASSUMED_CAMERA_HFOV_DEG` (`src/lib/motionSensor/consts.ts`, ~65°) is the one tuning constant standing in for it; vertical FOV is derived from the displayed aspect ratio. That constant, and the axis signs in `mapRotationRateToScreen`, were tuned on-device by panning the phone and watching the debug overlay's `motion` row (delta yaw/pitch in degrees) and `offset` row (dx/dy in pixels), not derived analytically. Re-tune `ASSUMED_CAMERA_HFOV_DEG` if a different camera or model changes the effective field of view, and fix the signs in `mapRotationRateToScreen` or `orientationDeltaToPixels` if a pan ever moves the box the wrong direction.

### 4.3 Analytics events

All analytics is anonymous and carries no camera, location, or detection-geometry data (§3). Since the app has no backend, these events are its only telemetry, and the operational ones below are the only view into whether it works on real devices.

**Health events**, emitted from `DetectionContext`'s worker-message handlers so they fire once at their source (not from React render or state updaters, which StrictMode double-invokes):

- `backend_resolved` `{ backend }` and `model_ready` `{ backend, fromCache }` both fire on the worker's `ready` message, but only on the **first** `ready` of the page load (gated by `readyTrackedRef`): the periodic worker recycle (§6a) produces a fresh `ready` every 15 minutes, which must not re-fire them. The first captures the WebGPU/WASM split across the device population; the second captures load success and runtime-cache hit rate (`fromCache` is carried from the earlier `model-load-start` message via `modelFromCacheRef`).
- `error` `{ code }` fires wherever a failure surfaces to the user. Detection failures are tracked at their origin in `DetectionContext` (the `worker-error` handler with the `DetectionErrorCode`, and `onerror` with `WORKER_CRASHED`); camera failures are tracked in `App.tsx` by an effect on `cameraError`, since `getUserMedia`'s result only reaches the UI there. The `CameraErrorCode` breakdown (permission-denied rate especially) is the app's most valuable funnel signal.
- `pwa_installed` fires once when the app runs as an installed PWA (`src/lib/pwaInstall`, called from `main.tsx`). Two paths feed it, deduped by a `dashradar:pwaInstalled` localStorage flag: Chromium's `appinstalled` event captures the true install moment, while iOS (Safari implements no `appinstalled`, and every install is a manual Add to Home Screen) is caught on the **first standalone launch**, detected via `display-mode: standalone` or the legacy `navigator.standalone`. iOS gives installed PWAs storage isolated from Safari's tabs, so a browsing-session flag never leaks into the installed app and the first standalone launch always looks fresh. Two reading caveats: it counts only installs the user actually launched at least once, and EU iOS 17.4+ can open installed PWAs in a browser tab where standalone detection does not apply.

**Police sighting event.** The `detections` result handler in `DetectionContext` reports an anonymous `police_detected` event when police come into view. It fires on the **leading edge only**: the event is sent the frame police first appear, then stays quiet until police have been absent for `POLICE_EVENT_DEBOUNCE_MS` (`DetectionContext/consts.ts`, 30 s), so following a car continuously (a detection roughly once a second, §4 pump) collapses into one event rather than a flood. A sighting after that much absence counts as a fresh encounter and fires again.

The handler keys off the frame's fresh road-filtered detections (any carrying `POLICE_LABEL`), not the coasting tracker's `visible` set (§5), so a briefly held stale box does not keep the debounce alive. `lastPoliceSeenAtRef` holds the `performance.now()` of the last sighting; it starts at `Number.NEGATIVE_INFINITY` (not `0`, which is only ~page-load time and would swallow a sighting in the first 30 s) so the first sighting always reads as fresh. The `track()` call sits in the message handler body, deliberately not inside the `setHud` updater: React double-invokes state updaters under StrictMode, which would double-count the sighting. The event carries no payload: no location, no box, no image, no score, only the count.

### `SettingsContext` / `useSettings()`

App-wide display options, persisted to `localStorage` under `dashradar:settings`
and validated on read with `isPersistedSettings`. Five options:

```ts
type SettingsContextValue = {
  showVideo: boolean;
  toggleShowVideo: () => void;
  showDebug: boolean;
  toggleShowDebug: () => void;
  stabilizeMotion: boolean;
  toggleStabilizeMotion: () => void;
  radarDetectorMode: boolean;
  toggleRadarDetectorMode: () => void;
  radarAudio: boolean;
  toggleRadarAudio: () => void;
  settingsOpen: boolean; // ephemeral, not persisted
};
```

`showVideo` controls only presentation. When it is false the camera `<video>`
stays mounted and playing (so the detection pump keeps reading frames) but is
hidden with `opacity-0`, revealing the `RadarBackdrop` grid behind it. The
detection pipeline is never touched by the toggle. `showDebug` (default false)
gates the `DebugOverlay` panel and the confidence/coords annotations
`HudOverlay` draws on each detection; it doesn't change what detection does
either. `stabilizeMotion` (default false) turns on gyro motion compensation
(§4.2): it drives `HudOverlay`'s `stabilize` prop and, on iOS, is the opt-in
that lets `StartGate` appear to request motion permission. `radarDetectorMode`
(default on, persisted like the others) gates the fullscreen radar-detector
meter: `RadarScreen` renders `RadarDetectorScreen` in place of `HudOverlay` and
`RadarStrip` while it's on, so the radar-detector meter is what a fresh user
sees first; toggling it off switches to the bounding-box HUD. `radarAudio`
(default on) gates the beeping audio indicator inside radar-detector mode:
`RadarDetectorScreen` feeds the raw signal (not the peak-held meter level) to
the `lib/radarAudio` beeper when the setting is on and silence when it's off,
so the beeps cut off the instant a detection is gone while the dial decays
smoothly behind them, and never play in the bounding-box HUD. Beeping while
the dial shows nothing is impossible by construction: the peak-held dial level
is never below the raw signal, and `AUDIO_FLOOR` sits at or above the dial's
`CONTACT_THRESHOLD`, so any audible level has already flipped the dial to
ALERT. `SettingsProvider`
wraps the app outside `DetectionProvider`;
`SettingsButton` (a gear in `StatusBar`) opens the full-screen
`SettingsScreen`, which is the only UI that writes any of these options.

`isPersistedSettings` validates a `Partial<Settings>` shape: each known field
is optional-but-typed, so a stored blob is accepted even if it predates a
newer field (or a future build removes one) and `loadSettings` fills any
missing field from `DEFAULT_SETTINGS`. A corrupt value (not JSON, not an
object, or a field with the wrong type) falls back to `DEFAULT_SETTINGS`
entirely. This is what keeps loading a pre-`showDebug` stored blob from
wiping out the also-stored `showVideo` value.

---

## 5. Detection Domain (`src/lib/detection`)

### Road-class filter and confidence threshold

The worker emits `RawDetection`s whose `label` is a string; only labels in the allowlist are ever shown. `ROAD_CLASSES` (`src/lib/detection/consts.ts`) maps a label to a display label and category:

| Label(s) | Display label | Category |
| --- | --- | --- |
| `police` | POLICE | vehicle |
| `car` | CAR | vehicle |
| `truck` | TRUCK | vehicle |
| `bus` | BUS | vehicle |
| `motorcycle` | MOTO | bike |
| `bicycle` | BIKE | bike |
| `person` | PERSON | person |
| `traffic light` | SIGNAL | signal |
| `stop sign` | STOP | signal |
| `bird`, `cat`, `dog`, `horse`, `sheep`, `cow`, `bear`, `elephant`, `zebra`, `giraffe` | ANIMAL | animal |

The shipped RF-DETR model is single-class and only ever emits `police`; the remaining (COCO) entries are dormant carryovers from when a generic COCO detector was loaded, kept so a multi-class model can be swapped back in without touching the filter. Any label not in `ROAD_CLASSES` is dropped by `toRoadDetections` before it reaches the UI.

`CONFIDENCE_THRESHOLD` is `0.7`. It's applied twice: once in the worker's `decodeDetections` (a query is emitted only when `sigmoid(policeLogit) >= CONFIDENCE_THRESHOLD`), and again defensively in `toRoadDetections` (`candidate.score < CONFIDENCE_THRESHOLD` is dropped) so a low-confidence result can never slip through. `SIGNAL_FLOOR` (`src/lib/radarSignal/consts.ts`), the score the radar-detector meter treats as zero signal, is also `0.7` and is meant to move in lockstep with `CONFIDENCE_THRESHOLD`: since the road filter already drops anything below the confidence threshold, the meter would otherwise waste part of its range on scores that can never reach the HUD.

### Coasting tracker (`src/lib/detectionTracker`)

`src/lib/detectionTracker` sits between `toRoadDetections` and `buildHudModel`. It shows each road-filtered detection right away and only smooths flicker: when the model drops an object for a frame or two, the tracker keeps its last box on screen so it doesn't blink off. Pipeline position:

```
worker → toRoadDetections (confidence >= 0.7) → detectionTracker (coast on miss) → buildHudModel
```

The module is React-free and stateful, split into a pure step function and a stateful wrapper around it: `stepTracker(state, detections, config)` runs one frame and returns the next `TrackerState` plus the `visible` detections; `createDetectionTracker()` wraps it in a small factory exposing `.update(detections)`, which is what `DetectionContext` calls once per frame (§4). `initialTrackerState()` gives an empty starting state, and `iou(a, b)` is the shared intersection-over-union helper both the tracker and its tests use.

Each frame, `stepTracker` greedily matches this frame's detections to existing tracks by IoU (`IOU_MATCH_THRESHOLD`, `0.3`), picking each track's best available match above the threshold, then applies these rules:

- A **matched** track adopts the new detection's box outright but eases its score toward the new raw value by `SCORE_SMOOTHING_ALPHA` (`0.5`) instead of replacing it, and resets its miss count. It stays visible. The blend averages out per-frame model score jitter (which the radar-detector meter's `SIGNAL_FLOOR` remap would otherwise amplify roughly 3x into large percentage swings) while a brand-new track still shows its first score unsmoothed.
- An **unmatched** track coasts through up to `MAX_MISSES` (`2`) consecutive frames with no match before it is dropped, keeping its stale box and score, so the box doesn't flicker off when the model briefly loses the object for a frame or two.
- An unmatched detection in the current frame starts a brand-new track that is shown immediately.

Every track is returned as a `visible` detection for `buildHudModel` to shape (there is no confirmation delay). The debug overlay's `detections` row reflects all three pipeline stages, read left to right as `shown / filtered / raw` (`DebugSnapshot.shownCount` / `.filteredCount` / `.rawCount`, §4).

### Nearest object and the NEAR heuristic

`buildHudModel` (`src/lib/detection`) shapes one frame's filtered detections for the HUD:

- **Nearest**: the detection with the largest normalized box area (`(xmax - xmin) * (ymax - ymin)`, clamped to non-negative). There is always at most one nearest detection, and it's excluded from `others`.
- **NEAR flag**: `true` only when the nearest detection's box area is at least `NEAR_AREA_FRACTION` (`0.06`, i.e. the box covers 6% or more of the frame). A "nearest" detection below that fraction still gets the single full box (just without the amber/NEAR treatment); see §6.
- **Blips**: one per filtered detection, positioned at the box's horizontal center (`(xmin + xmax) / 2`). Only the nearest detection's blip is flagged `near`, and only when the NEAR flag itself is true.

### Coordinate mapping (`mapBoxToViewport`)

The camera `<video>` renders with `object-fit: cover` (`src/components/CameraView`): scaled up and center-cropped to fill the viewport. `mapBoxToViewport` reverses that transform for a normalized box:

```
scale = max(viewport.width / video.width, viewport.height / video.height)
displayedWidth = video.width * scale
displayedHeight = video.height * scale
offsetX = (viewport.width - displayedWidth) / 2   // negative when video is cropped horizontally
offsetY = (viewport.height - displayedHeight) / 2  // negative when video is cropped vertically

left   = offsetX + box.xmin * displayedWidth
top    = offsetY + box.ymin * displayedHeight
width  = (box.xmax - box.xmin) * displayedWidth
height = (box.ymax - box.ymin) * displayedHeight
```

This holds regardless of phone orientation (the same formula crops horizontally in portrait and vertically in landscape, whichever dimension overflows the viewport). If the video's CSS ever changes away from `object-fit: cover`, this function's scale/offset math has to change with it, or boxes will drift off their objects.

`HudOverlay` rounds every computed pixel offset (`Math.round`) before handing it to an inline style, since the scale/offset arithmetic accumulates floating-point error that would otherwise show up as visible sub-pixel jitter.

---

## 6. HUD & Visual Design ("Autopilot")

Automotive-minimal HUD over a full-bleed video feed. Design principle: the road view stays clean, position is communicated spatially (the radar strip), and words are reserved for what matters. **Amber (`#FFB340`, the `--color-hud-amber` token) is the only accent color**; everything else is white/translucent-black on a near-black surface (`#0B0A10`, `--color-surface`). Dark theme only, no light variant and no in-app toggle. Typography is Rajdhani throughout.

- **Nearest object** (`HudOverlay`): the only full bounding box, rounded corners (10px). When flagged NEAR: a 2px amber border with a soft amber glow (`shadow-[0_0_18px_-6px_var(--color-hud-amber)]`) and an amber pill label (`<LABEL> · NEAR`, black text). When nearest but not NEAR (largest box, but under the area threshold): a plain white/85 border and a white-on-black pill label with no "· NEAR" suffix. Between detection results, the whole overlay container (both this box and the floating tags below) is nudged by a motion-compensation transform (§4.2) so it tracks the camera's pan instead of holding position until the next result.
- **Other detections**: no box. A floating tag above the object: a rounded pill (translucent black, thin white border, uppercase tracked Rajdhani, no confidence numbers) with a short fading vertical tick pointing down toward the object (offset `TAG_OFFSET_PX` = 30px above the box, clamped so it never goes negative).
- **Lane-radar strip** (`RadarStrip`, the signature glance element): a pill-shaped translucent bar bottom-center (46% of viewport width, minimum 16rem), divided into three lane segments by two faint vertical dividers. One blip per filtered detection, positioned by the object's horizontal box-center fraction. The nearest object's blip is larger (12px) and amber with a glow, but only when the NEAR flag is true; every other blip is a small (8px) white dot. Tells the driver where things are, left/center/right, without reading anything.
- **Status bar** (`StatusBar`, safe-area aware): `DASHRADAR.APP` wordmark top-left; the `SettingsButton` gear top-right. The `GPU · N FPS` / `CPU · N FPS` engine readout now lives in the full-screen `SettingsScreen`, not the bar. No object count is ever shown.
- **Debug overlay** (`DebugOverlay`, gated on the `showDebug` setting, off by default): a small monospace panel pinned top-left, below the wordmark. Shows engine + FPS, round-trip/capture/preprocess/inference/decode timing, worker-boundary overhead, shown/filtered/raw detection counts (§5), viewport and video pixel sizes, device pixel ratio, WebGPU availability, model download percent, and a `motion` row (delta yaw/pitch in degrees) plus an `offset` row (dx/dy in pixels) for tuning motion compensation (§4.2) on-device. `pointer-events-none` so it never intercepts taps. When on, `HudOverlay` also annotates the nearest box and every floating tag with a confidence percentage and normalized box coords, overriding the "no confidence numbers" rule above.
- **Model load screen** (`ModelLoadScreen`): same visual language, amber progress bar, byte counters formatted with `Intl.NumberFormat` (one decimal place, decimal megabytes). Delayed `LOADING_INDICATOR_DELAY_MS` (1 second) before appearing, so a fast (already-cached) load never flashes it.
- **Error screen** (`ErrorScreen`): wordmark, centered error copy keyed by error code (§8), and a "TRY AGAIN" button that does a full page reload.
- **Start gate** (`StartGate`, iOS only): a full-screen "TAP TO START" overlay shown after the user enables Motion stabilization, while motion permission is still ungranted (§4.2). Detection is already running underneath; the tap only unlocks the gyroscope so the HUD can start motion-compensating stale boxes. Never shown on Android/desktop, before the user opts in, or after a prior grant.
- **Intro screen** (`IntroScreen`, first open only): a full-screen landscape-first intro rendered by `RadarScreen` instead of the radar screen until dismissed. An animated radar scope (concentric rings, crosshair, pulsing blips, a slow conic-gradient sweep that stops under `prefers-reduced-motion`) sits beside the wordmark, a "POLICE DETECTION ON YOUR DASH" headline, a short pitch, three labeled points (on-device, offline, camera), and a large amber START button. On a desktop or laptop (`isDesktopDevice` in `src/lib/deviceType`, judged by a fine hover-capable primary pointer) the START button is replaced by the shared `ShareQr` code with a scan-to-continue-on-mobile prompt, since the app is built for a phone on a dash; a small "Continue on this device" link below it still dismisses the intro. Because `CameraView` is not mounted while the intro shows, the camera permission prompt fires right after the START tap instead of cold on page load; the model download still proceeds underneath in `DetectionProvider`. Dismissal is persisted under the `dashradar:introSeen` localStorage flag (`shouldShowIntro`/`markIntroSeen`); when localStorage is unavailable the intro shows again each visit rather than skipping a genuine first open.
- No nav and no dialogs. The only settings surface is the full-screen `SettingsScreen`, opened from the top-bar gear.

---

## 7. Offline & PWA Strategy

`vite-plugin-pwa` generates a Workbox service worker, registered in `src/main.tsx` via `virtual:pwa-register` with `registerType: "autoUpdate"` (silent background updates, no update-available prompt). The manifest (`vite.config.ts`) sets `name`/`short_name` to `dashradar`, `display: "standalone"`, `background_color`/`theme_color` to `#0B0A10`, and points at the icons in `public/` (192, 512, and a maskable 512 variant).

**Two independent caches make the app work fully offline, and each is populated by a different mechanism:**

1. **App shell precache** (Workbox `globPatterns: ["**/*.{js,css,html,svg,png,woff,woff2}"]`, `maximumFileSizeToCacheInBytes: 40_000_000`): every built JS/CSS/HTML/font/icon file, including the detection worker's own chunk. It's built via `new Worker(new URL(...), { type: "module" })`, so Vite emits it as a separate chunk, but that chunk is still matched by the `js` glob and precached like any other script. This is what makes a cold load work with zero connectivity.
2. **Model weights + the ONNX runtime itself**, cached by two Workbox `CacheFirst` runtime-caching routes (`vite.config.ts`):
   - The `"model-cache"` route caches the RF-DETR ONNX weights the worker `fetch()`es from `huggingface.co`. The worker streams the download itself (reading the response body chunk by chunk) to report byte progress, so the weights are not part of the precache glob; the runtime route is what keeps them offline after the first run. The `huggingface.co` `resolve` URL responds with a 302 to a signed, per-request CDN URL, but Workbox keys the cache on the stable `huggingface.co` request URL, so later visits still hit the cache even though the redirect target changes each time. Before fetching, the worker probes this cache with `caches.match(url)` (CacheStorage is shared with the service worker) to tell whether this load is a cache hit or a network download, and reports that as `model-load-start`'s `fromCache`. The match succeeds even though the cached response carries `Vary: origin, access-control-request-method, access-control-request-headers`, because the worker's simple GET and the probe request both omit those headers, so Vary matching treats them as equal.
   - The onnxruntime-web `.wasm`/`.mjs` runtime is served **same-origin** from `/ort/` (the worker sets `env.wasm.wasmPaths` to `/ort/`), not from a CDN. The `ortRuntime` Vite plugin copies the two files the worker's `onnxruntime-web/webgpu` bundle actually fetches (`ort-wasm-simd-threaded.asyncify.wasm` and its `.mjs` glue; the root import would fetch the `jsep` pair instead, so `ORT_RUNTIME_FILES` must track the worker's import, §4.1.1) out of `node_modules` into dev and the build output, and prunes the hashed duplicate Vite would otherwise leave in `dist/assets/`. The `"ort-runtime"` route caches the `/ort/` requests, so the runtime is fetched on first use and available offline afterward (not precached, to avoid front-loading ~24 MB into the service-worker install). Serving it same-origin is also what lets cross-origin isolation (§7.1) stay on without the runtime needing a cross-origin exemption.

**First-visit caching depends on the worker being controlled.** The model is `fetch()`ed from inside the detection Web Worker. On a genuine first visit the worker can be created and start fetching before the service worker takes control of the page (the `clientsClaim` race), so that first fetch bypasses the `"model-cache"` route entirely and nothing is stored until a later visit. `DetectionContext` therefore defers the worker's `load` message until `navigator.serviceWorker.controller` is set (`waitForServiceWorkerControl`, `src/lib/serviceWorker`), bounded by `SW_CONTROL_TIMEOUT_MS` (3 s) so startup never stalls, and only in production (dev has no service worker). `src/main.tsx` also calls `requestPersistentStorage()` (a best-effort `navigator.storage.persist()`) so the browser is less likely to evict the cached weights between visits, which matters most on storage-constrained mobile browsers.

**Verify offline behavior** by inspecting the network log and Cache Storage in a real browser: after a fresh load `caches.keys()` should include the Workbox precache plus the `"model-cache"` and `"ort-runtime"` routes, and a subsequent offline hard reload should cold-load the app and run live inference with no network requests.

### 7.1 Cross-origin isolation (WASM threading)

The app is served **cross-origin isolated**: `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp`, from `vercel.json` in production and Vite `server`/`preview` headers in dev. This makes `SharedArrayBuffer` available, which is what lets onnxruntime-web run its WASM backend multi-threaded (`env.wasm.numThreads`, set in the worker and capped by `WASM_THREAD_CAP` in `src/workers/detection/consts.ts`, default 4 for mobile big.LITTLE efficiency). Without isolation, ORT silently clamps to one thread. On the large share of mobile devices that expose no usable WebGPU adapter and therefore run on WASM (e.g. Chrome on a Pixel whose GPU is blocklisted for WebGPU), single-threaded inference runs several times slower, so isolation is load-bearing for real-device performance, not a nicety.

`require-corp` was chosen over `credentialless` because it is supported on every browser including Safari. It is only viable because nothing the page loads needs a cross-origin exemption: the ONNX runtime is same-origin (`/ort/`, §7), the Hugging Face model `fetch()` is a CORS request (CORS responses satisfy `require-corp`), and Vercel Analytics is served same-origin (`/_vercel/...`). Adding any cross-origin subresource without CORS/CORP (a CDN `<script>`, a `no-cors` fetch) will be blocked. The worker's backend probe reports `crossOriginIsolated` and the effective thread count, shown in the debug overlay as `wasm N T · isolated`, so the isolation state is verifiable on-device.

**Regenerating PWA icons**: rasterizing `public/icon.svg`/`icon-maskable.svg` to PNG with headless Chrome (`--screenshot`) at a small `--window-size` (e.g. 192x192 or 180x180) produces a cropped/misaligned image even though the reported pixel dimensions look correct. Render at 512x512 (reliable) and downscale with `sips -z <height> <width>` for the smaller sizes instead.

---

## 8. Error Handling

Typed error classes with a machine-readable `code` (`CLAUDE.md`'s "Typed errors over string messages"), not string-matched `Error` messages.

### `CameraError` (`src/lib/camera/types.ts`)

`getCameraStream` maps failures from `getUserMedia` (`toCameraError`, `src/lib/camera/index.ts`):

| `DOMException.name` | `CameraErrorCode` |
| --- | --- |
| `NotAllowedError`, `SecurityError` | `PERMISSION_DENIED` |
| `NotFoundError`, `OverconstrainedError` | `NO_CAMERA` |
| `NotReadableError`, `AbortError` | `CAMERA_IN_USE` |
| any other `DOMException`, or a non-`DOMException` throw | `NO_CAMERA` (default) |
| `navigator.mediaDevices.getUserMedia` missing entirely | `UNSUPPORTED` (thrown directly, before any `getUserMedia` call) |

### `DetectionError` (`src/workers/detection/types.ts`)

| `DetectionErrorCode` | Raised when |
| --- | --- |
| `MODEL_LOAD_FAILED` | The model download or `InferenceSession.create` throws while loading the model (`loadModel`'s catch), on both the preferred backend and the wasm fallback |
| `INFERENCE_FAILED` | A single frame's inference throws (`detect`'s catch), including a missing 2D canvas context |
| `WORKER_CRASHED` | The worker thread crashes outside its own try/catch; set by `DetectionContext`'s `worker.onerror` handler on the main thread. The worker itself never posts this code |

### User-facing copy (`AppErrorCode = CameraErrorCode | DetectionErrorCode`, `src/components/ErrorScreen/consts.ts`)

| Code | Copy shown in `ErrorScreen` |
| --- | --- |
| `PERMISSION_DENIED` | "Camera access is blocked. Allow camera access for this site in your browser settings, then try again." |
| `NO_CAMERA` | "No camera was found on this device." |
| `CAMERA_IN_USE` | "The camera is in use by another app. Close it, then try again." |
| `UNSUPPORTED` | "This browser can't access the camera. Try a recent version of Chrome or Safari." |
| `MODEL_LOAD_FAILED` | "The detection model couldn't be downloaded. Check your connection, then try again." |
| `INFERENCE_FAILED` | "Detection stopped unexpectedly. Reload to restart it." |
| `WORKER_CRASHED` | "Detection stopped unexpectedly. Reload to restart it." |

Every code renders a "TRY AGAIN" button that does a full `window.location.reload()`; there is no soft, in-app retry path.

---

## 9. Testing Strategy

Vitest + Testing Library, **behavior-focused** (verify behavior, not implementation constants, per `CLAUDE.md`). jsdom has no camera, no Worker that can run real code, no WebGPU/WASM, and no layout engine, so the worker, onnxruntime-web inference, the camera, and real rendering are verified separately in a real browser (chrome-devtools MCP) and on-device by the user; unit tests stub or inject those seams:

- **`src/lib/detection`**: the road-class filter and confidence threshold (`toRoadDetections`); the nearest/NEAR heuristic and blip shaping (`buildHudModel`), including the empty-frame case and the exact `NEAR_AREA_FRACTION` boundary; `mapBoxToViewport`'s cover-fit math for square, portrait-crop, and landscape-crop cases.
- **`src/lib/detectionTracker`**: `iou` against identical, disjoint, and partially overlapping boxes; `stepTracker` showing a detection immediately on its first sighting, coasting a track through `MAX_MISSES` frames before dropping it, keeping one track matched as its box drifts (IoU match), adopting a matched detection's box outright while easing its score by `SCORE_SMOOTHING_ALPHA` (damping alternating score jitter, adopting raw scores at alpha 1, first sighting unsmoothed), and greedily matching two detections to two separate tracks without double-claiming; `createDetectionTracker` holding state across calls.
- **`src/lib/camera`**: constraint building (rear camera requested) and every `DOMException` name mapped to its `CameraErrorCode`, plus the `UNSUPPORTED` path when `mediaDevices` is missing, via `vi.stubGlobal("navigator", …)`.
- **`src/lib/wakeLock`**: acquire/release call the Wake Lock API correctly, re-acquires on a stubbed `visibilitychange` event, stops re-requesting after release, and is a safe no-op when the API is unsupported.
- **`src/lib/serviceWorker`**: `waitForServiceWorkerControl` resolves immediately when the Service Worker API is absent or a controller already exists, resolves on a `controllerchange` event when initially uncontrolled, and resolves via the timeout when control never arrives (fake timers), via `vi.stubGlobal("navigator", …)`.
- **`src/workers/detection`**: `isWorkerResponse` accepts every valid message variant and rejects malformed ones (unknown backend, missing fields, unknown error code); the pure `preprocess` (ImageNet normalization, NCHW layout) and `decodeDetections` (sigmoid thresholding, cxcywh-to-xyxy, class-index-1 selection) helpers in `inference.ts` are tested directly against known inputs.
- **`src/context/DetectionContext`**: the full status machine against an injected fake worker (the `createWorker` test seam), including the one-frame-in-flight invariant across a fast `stop()`-then-`start()` (a regression test for a real race that was fixed), a detection reaching the HUD immediately on its first frame and its box coasting through a frame the model misses it, retrying after a `createImageBitmap` failure, and the FPS calculation staying finite. Because the `load` message is now deferred to a microtask (`import.meta.env.PROD` is false in tests, so it resolves immediately), the "starts loading on mount" test awaits it with `waitFor` rather than asserting synchronously.
- **`src/context/SettingsContext`**: defaults `showVideo`, `showDebug`, and `stabilizeMotion` to their defaults (true, false, false), toggling any flips it and persists all three to `localStorage`, a fresh mount restores the persisted values, corrupt or wrong-shaped stored JSON falls back to defaults, and loading a pre-`showDebug` stored blob (missing that field) keeps the stored `showVideo` value while the missing fields fall back to their defaults.
- **Components** (RTL): `CameraView` attaches the stream and reports a typed error on failure (stubbing `getUserMedia`); `HudOverlay` renders the nearest box with/without the NEAR pill, positions floating tags using exact pixel assertions against known inputs, and shows/omits the confidence-and-coords annotation on both the nearest box and floating tags based on the `debug` prop; `RadarStrip` positions one blip per detection by fraction and styles the near blip amber; `StatusBar` renders the wordmark and the settings gear and shows no FPS readout; `DebugOverlay` renders nothing when `showDebug` is off and shows the diagnostics panel with the expected FPS/size/count text when it's on; `ModelLoadScreen` stays hidden during the anti-flash delay and then shows byte/percent progress; `ErrorScreen` covers every error code with non-empty copy; `SettingsButton` opens the panel; `SettingsScreen` renders nothing until opened, toggles and persists the video, debug, and motion-stabilization settings, shows the live engine readout (or a starting placeholder), and closes on the close button or Escape; `RadarBackdrop` renders a non-interactive full-bleed grid; `CameraView` keeps the video mounted but `opacity-0` when `visible` is false; `IntroScreen` fires `onStart` from the START button, swaps it for the QR code plus a working "Continue on this device" link on a desktop pointer, and its `shouldShowIntro`/`markIntroSeen` helpers round-trip the localStorage flag; `App` shows the intro on first open, then the camera-unavailable error screen end-to-end with a stubbed `Worker` and `navigator`.

Real camera video, real onnxruntime-web inference (both backends), and real layout/visual rendering are verified manually: chrome-devtools MCP against a built preview (`pnpm build && pnpm start`) for the model-load screen, backend detection, first-visit model caching, offline cold-load, and Cache Storage contents; genuine on-device phone testing (sustained FPS against real traffic, both orientations, thermal/battery behavior) is the user's job post-merge, since neither jsdom nor a desktop headless browser has a real dash-mounted camera.

---

## 10. Non-Functional Requirements

- **Offline-first**: fully functional with no network after the first successful model download (see §7). Service worker updates apply silently (`autoUpdate`, no UI prompt).
- **No secrets, no logging of sensitive data** (`CLAUDE.md`): v1 has no secrets and no user data to log in the first place; the camera stream and every detection stay in the tab.
- **`pnpm check` clean** (format, lint, typecheck) before commits.
- **Bundle size**: no date-picker, form, or crypto libraries carried over from the starter; the largest code dependency is `onnxruntime-web` itself, an accepted cost for on-device inference (the model weights are downloaded from Hugging Face at runtime, not bundled). The ONNX runtime `.wasm` (~24 MB, `ort-wasm-simd-threaded.asyncify.wasm`) is served same-origin from `/ort/` (§7) and fetched on first use, not bundled into the app shell or precached; the `ortRuntime` plugin prunes the hashed duplicate Vite would otherwise emit into `dist/assets/`.

## 11. Success Criteria (Acceptance)

1. Opening the app on a phone requests the rear camera and shows the live feed full-screen.
2. On a WebGPU-capable device, the nearest road-relevant object gets an amber box and label once its box is large enough to count as NEAR; other road-relevant objects get floating tags; the radar strip shows a blip per detection.
3. On a device without WebGPU, the same behavior runs on the WASM fallback, more slowly, with the status bar reading `CPU` instead of `GPU`.
4. Camera permission denial, no camera, camera-in-use, and an unsupported browser each show their own explanatory `ErrorScreen`, never a blank page or an uncaught exception.
5. A model load failure or an inference crash shows an error screen with a working reload action, not a blank page.
6. The screen does not sleep while detection is running, and re-locks/re-acquires correctly around tab visibility changes.
7. After the first successful load, the app cold-loads and runs live detection fully offline.
8. All tests pass and `pnpm check` is clean.
