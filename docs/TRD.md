# TRD: dashradar

> Technical Reference Document. See [CLAUDE.md](../CLAUDE.md) for project conventions.

**Status:** Shipped (v1) · **Date:** 2026-07-11 · **Owner:** Derek Petersen

dashradar turns a phone mounted on a car dash into a live police-detector instrument: a full-screen radar-detector-style meter driven by real-time, on-device object detection of the rear camera feed. The camera itself is never shown on screen; only the meter and, while a detection is present, a small evidence card are visible. Detection runs entirely in the browser via a custom RF-DETR ONNX model on raw onnxruntime-web, in a Web Worker, with WebGPU acceleration when available and a quantized WASM fallback otherwise. It is a client-only Vite React SPA, installable as an offline-first PWA. There is no backend, no accounts, and no data leaves the device: no video, frame, or detection is ever sent anywhere.

---

## 1. Goals & Non-Goals

### Goals

- Turn a phone's camera into a live object-detection HUD, useful mounted on a car dash.
- Detection entirely **on-device**, in a **Web Worker** so inference never blocks the video.
- A clean, **automotive-minimal instrument** (the radar-detector-style meter): a single glanceable readout communicates signal strength, words are reserved for what matters (SCANNING/ALERT).
- **Offline-first**: works with no connection after the model has downloaded once.
- Keep the phone's screen from sleeping while running (Screen Wake Lock).
- **WebGPU when usable, WASM fallback otherwise**, chosen automatically with no user-facing setting.

### Non-Goals (v1)

- No video recording, no on-device history of detections, no audible alerts. (Analytics does receive a single anonymous `police_detected` count per sighting, debounced; it carries nothing that identifies the sighting. See §3 and §4.2.)
- No accounts, sync, or server component of any kind. The only state that persists across reloads is the browser's model-weight cache and a small `localStorage`-backed display-settings object (`dashradar:settings`, e.g. the debug overlay toggle). There is no IndexedDB and no history.
- No manual model/backend picker and no nav. Settings are a single full-screen panel (audio and debug overlay toggles plus read-only engine/model/about), opened from the top-bar gear.
- No object count in the HUD, no confidence scores shown to the user (used internally for thresholding only).

Success criteria: on a phone with WebGPU, the radar-detector-style meter reads a stable, sub-second-latency signal as police vehicles pass through frame; on the WASM fallback, detection updates slow down but the UI never blocks; the app works offline after the first launch.

---

## 2. Target Platforms & Device Support

Primary target: a phone mounted in landscape on a car dash, orientation unlocked (`RadarDetectorScreen`'s CSS repositions the contact card directly for either orientation; §5 documents the retained, currently-unused coordinate-mapping math from the app's earlier bounding-box HUD). Modern iPhone Safari and Android Chrome are the intended runtime; desktop Chrome/Edge work and are useful for development but are secondary.

| Backend | Chosen when | Model build | Notes |
| --- | --- | --- | --- |
| WebGPU | A GPU adapter **and** device can actually be acquired, and the adapter exposes `shader-f16`: `resolveBackend()` awaits `navigator.gpu.requestAdapter()`, checks `adapter.features.has("shader-f16")`, then awaits `adapter.requestDevice()` (`src/workers/detection/index.ts`) | `model_fp16.onnx` (mixed precision: fp16 weights/compute, GridSample kept fp32, fp32 I/O, ~57 MB) | Faster, and runs with graph capture (§4.1.1) on the native WebGPU EP; the mixed-precision export sidesteps the JSEP fp16 GridSample bug (§4.1); verified end-to-end in Chrome via chrome-devtools MCP |
| WASM | No usable WebGPU: `navigator.gpu` is absent, `requestAdapter`/`requestDevice` returns nothing or throws, or the adapter lacks `shader-f16` | `model_int8.onnx` (int8 dynamic quant, fp32 I/O, ~31 MB) | Universal fallback; the smaller int8 build keeps the CPU path usable |

`resolveBackend()` probes for a real device **before** any weights are downloaded, rather than trusting that `navigator.gpu` merely exists. Some devices expose the API but cannot create a device; trusting the existence check would download the larger fp16 WebGPU build, fail at `InferenceSession.create`, then fall back to downloading the int8 build too. Probing first sends an unusable GPU straight to wasm so only one set of weights is fetched. (`@webgpu/types` provides the ambient WebGPU type declarations, referenced from `src/vite-env.d.ts`.) The webgpu-to-wasm fallback in `loadModel` is kept as a safety net for the rarer case where the probe passes but the session still fails to create.

The `shader-f16` gate is load-bearing for the shipped fp16 build: its fp16 tensors make onnxruntime-web require `shader-f16` at session creation, so requiring it up front keeps the backend choice a two-way split and sends a WebGPU-without-`shader-f16` device (rare on the phones this app targets) down the WASM path instead of failing the session and double-downloading. The debug overlay's `shader-f16` row reports the verdict per device.

No usable WebGPU is not treated as an error: the backend badge in `StatusBar` (`GPU` vs `CPU`) is the only place this is surfaced. There is no manual override.

**WASM safe mode** (`src/lib/backendSafeMode`): when the crash sentinel (§8) classifies the previous session as a crash on the WebGPU backend and the sentinel record carries the current build's `APP_RELEASE` stamp (`shouldCountWebGpuCrash`; a record left by an older build never counts, so every deploy genuinely retries WebGPU), `src/instrument.ts` calls `recordWebGpuCrash()`, incrementing a release-keyed crash streak in localStorage (outside the DNT gate; a local stability decision, not telemetry). Safe mode arms at `SAFE_MODE_CRASH_THRESHOLD` (2) consecutive crashes; a lone classification never downgrades a device, because it can come from a one-off memory spike or a false read (for example a second tab consuming a live heartbeat). A cleanly ended scanning session resets a below-threshold streak (`resetWebGpuCrashStreak`, called from the sentinel effect's clean-end path); an armed record survives clean ends, since armed sessions run WASM and prove nothing about WebGPU, and holds for the rest of the release so a crashing GPU path cannot alternate crash/clean on every other drive. A new deploy discards the record so each build retries WebGPU. While armed, every `load` message carries `forceWasm: true`, `resolveBackend(true)` returns wasm without touching the GPU, and the backend probe reports `safeMode: true` (the debug overlay's engine row shows "(safe mode)"). Note the wasm weights may not be cached yet on a device that had been running WebGPU, so the first safe-mode launch can show the download screen.

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
| Intro scene | **three.js** | Renders `IntroScene`, the intro screen's wireframe night-drive scene with a bloom pass; the app's one 3D surface. Named imports plus `three/addons` postprocessing; ships in the initial bundle by design (no lazy loading), a deliberate size tradeoff for the first-open impression. |
| Fonts | **Rajdhani** | Self-hosted via `@fontsource/rajdhani` (weights 500/600/700), imported in `src/main.tsx`. Only font in the app. |
| Utilities | **remeda** | Type guards (`isString`, `isNumber`, `isPlainObject`) validating worker messages crossing the `postMessage` boundary. |
| Analytics | **`@vercel/analytics`** | `inject()` in `src/main.tsx`. Anonymous events only, never camera frames, detection boxes, or location: page views, UI events (`intro_start`, `settings_open`, `share_click`), health events (`backend_resolved`, `model_ready`, `error`, `pwa_installed`), and a debounced `police_detected` sighting count. See §4.2. |
| Testing | **vitest** + **@testing-library/react** | jsdom environment; the worker, onnxruntime-web inference, and camera are stubbed or injected (see §9). The pure preprocess/decode helpers are unit-tested directly. |

> **Build note:** `package.json` scripts: `pnpm dev` → `vite`, `pnpm build` → `vite build`, `pnpm start` → `vite preview`. `pnpm test` runs vitest. `pnpm check` runs format + lint + typecheck and must pass before commits. `DASHRADAR_VIDEO=<path> pnpm dev` substitutes a local video file for the camera feed (§4.3).

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
    CameraView/                 # the <video> element; owns getUserMedia lifecycle, reports the element + errors; always rendered opacity-0, the camera feed is never shown on screen
    DevVideoView/               # dev-only stand-in for CameraView (no onError, camera errors don't exist in this mode): plays DEV_VIDEO_URL as the detection feed and doubles as a visible, controllable corner player (§4.3)
    RadarBackdrop/              # static radar-grid layer shown behind the (always-hidden) feed; the only thing ever visible in that layer
    RadarDetectorScreen/        # opaque fullscreen radar-detector-style instrument, the only detection UI, rendered unconditionally once the model has loaded (the ladder segments as radial ticks on a tachometer-style arc around a percentage readout and SCANNING/ALERT status word, with a scanning sweep, signal-colored glow, and pulsing alert ring; no camera or boxes), driven by a requestAnimationFrame peak-hold/decay loop writing to the DOM; the same loop drives the lib/radarAudio beeper (gated by the radarAudio setting); also renders a contact card beside the dial (right side in landscape, docked below it in portrait) from useDetection()'s optional contact prop, canvas-drawing the cutout above a direction row (no label or percent; the dial already carries the number; the row renders only while the raw signal is nonzero, so no stale heading shows while the card lingers through the decay tail); the card's opacity is written by the same rAF loop through a data-contact attribute on the root, so it normally fades in and out with the peak-held meter and only shows while a contact exists; in debug mode the card instead stays lit for as long as a contact exists (regardless of the meter level), so the per-scan frame preview is visible on every scan including detection-free ones; while the debug prop is on the card also shows a SAVE button (lib/saveFrame) that downloads the full inference frame as a timestamped JPEG for collecting training data; the card's visibility is delayed-visibility CSS rather than opacity alone, so it stays clickable through the fade-out and only goes untappable once fully invisible
    StatusBar/                  # wordmark + settings gear
    SettingsButton/             # enlarged gear that opens the full-screen settings panel
    SettingsScreen/             # full-screen settings panel: audio alerts + debug overlay toggles + engine/model/about + share row
    ShareCard/                  # share row (settings) + ShareQr, the pre-rendered dashradar.app QR code on a white card, reused by the desktop intro
    DebugOverlay/               # top-left diagnostics panel (timing, detection counts, system info); shown only when showDebug is on
    ModelLoadScreen/            # download-progress screen (percent + MB), delayed to avoid a flash, shown only for a real network download (not a cache load)
    ErrorScreen/                # full-screen camera/detection error copy + reload action
    IntroScreen/                # full-screen first-open intro (app pitch + START button over the IntroScene backdrop; on desktop the QR code + a continue link instead); rendered instead of the radar screen until dismissed, persisted under dashradar:introSeen
    IntroScene/                 # three.js wireframe night-drive scene behind the intro copy: scrolling amber grid, white-headlight and red-taillight traffic, bloom, and a looping lock-on detection beat with a DOM bracket; portrait-first, reduced-motion and no-WebGL fallbacks, disposed on dismissal
  context/
    DetectionContext/           # worker lifecycle, frame pump, status machine; consume via useDetection()
    SettingsContext/            # display options (developerOptions, showDebug, radarAudio, …) + ephemeral settings-open state; consume via useSettings()
  lib/
    appRelease/                 # APP_RELEASE, the dashradar@version+sha build id shared by Sentry, the safe mode, and the sentinel stamp
    backendSafeMode/            # release-keyed WebGPU crash streak; arms WASM safe mode at 2 consecutive crashes, reset on clean ends, discarded by the next deploy
    branding/                   # WORDMARK, the uppercase display wordmark shared by StatusBar, ErrorScreen, and the intro eyebrow
    browserEngine/              # isWebKitUa: engine detection from a UA string; gates WebGPU graph capture off on WebKit (pure)
    camera/                     # getUserMedia wrapper; typed CameraError; rear-camera constraints
    crashSentinel/              # localStorage heartbeat + next-launch crash/unclean classification for the iOS page-killed-mid-scan case (pure)
    detection/                  # road-class filter, NEAR heuristic, HUD shaping, coordinate mapping (pure)
    detectionTracker/           # coasting flicker smoother between toRoadDetections and buildHudModel: greedy IoU matching, show-immediately, coast-on-miss (pure step function + stateful factory)
    deviceType/                 # isDesktopDevice: fine hover-capable pointer media query; mobile when matchMedia is unavailable
    devVideo/                   # DEV_VIDEO_URL, the compile-time __DEV_VIDEO_URL__ define; null outside a DASHRADAR_VIDEO dev-server run and always null in production builds (§4.3)
    pwaInstall/                 # trackPwaInstall: one-time pwa_installed analytics event via appinstalled (Chromium) + first standalone launch (iOS), deduped by a localStorage flag
    radarSignal/                # React-free math for the radar-detector-style meter: hudSignal (max police score across the HUD, remapped from the [SIGNAL_FLOOR, 1] score band onto [0, 1]), decayPeak (peak-hold + decay step), litSegments, signalColor (green to amber to red ramp), signalFromScore (the shared score-to-[0,1]-signal remap hudSignal delegates to, also stored on the contact cutout as its signal), and contactDirection (which third of the frame a detection's box center falls in; image-left is the driver's left), plus tuning consts SEGMENT_COUNT, DECAY_PER_SEC, SIGNAL_FLOOR, DIRECTION_LEFT_MAX, DIRECTION_RIGHT_MIN
    radarAudio/                 # React-free Web Audio beeper for the radar-detector screen: createRadarBeeper (one persistent square-wave oscillator; short self-terminating beeps that pulse faster and higher-pitched as the signal climbs, silence when nothing is detected, disposed on unmount) plus pure beepIntervalMs/beepFrequencyHz helpers; the AudioContext is created lazily on the first audible signal and unlocked from the next user gesture when autoplay policy suspends it
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
  contact: Contact | undefined;             // latest detection cutout for the radar-detector screen's contact card
  cameraEpoch: number;                      // bumped per recovery; App keys <CameraView> on it to remount and re-run getUserMedia
  start: (video: HTMLVideoElement) => void;
  stop: () => void;
};
```

`DebugSnapshot` (`src/context/DetectionContext/types.ts`) combines the worker's per-frame `FrameTiming` (`preprocessMs`, `inferenceMs`, `decodeMs`) with timing the context measures itself (`captureMs`, the time to capture the video frame into an `ImageBitmap`; `roundTripMs`, wall time from posting a frame to receiving its result) plus `rawCount`/`filteredCount`/`shownCount` (detections as decoded by the worker, after `toRoadDetections`, and after the `detectionTracker` coasting smoother, in that order; see §5), `overheadMs` (round-trip time not spent in the worker's three stages: postMessage delivery each way plus scheduling, clamped at 0), and `pacingDelayMs`/`pacingRule` (the idle delay `schedulePacedFrame` scheduled after the result and whether the absolute floor or the proportional rest set it, rendered as the overlay's `pacing` row). It updates on every `detections` reply regardless of whether `showDebug` is on, so toggling the overlay shows current numbers immediately rather than stale ones. Both the snapshot and the fps reading live in refs read through `getFps()`/`getDebugSnapshot()`, not React state: nothing renders them by default (the debug overlay is hidden), so per-result state updates would re-render every context consumer for values nobody is showing. `DebugOverlay`, the only consumer of either reader, polls both on its ~8 Hz readout tick.

`contact` (`Contact`, `src/context/DetectionContext/types.ts`) is the latest cutout the contact card renders. Usually a detection crop: the cropped `ImageBitmap` carried on the worker's `crop` field (see Worker protocol below), the detection's raw `score`, `signal` (the score remapped through `signalFromScore`, the same semantic as the dial readout; not currently rendered on the card), `box`, `direction` (`contactDirection`, which third of the frame the box center falls in), an optional `frame` (a `Blob`), and `at` (`performance.now()` when the reply arrived). A `detections` reply carrying a `crop` replaces `contact` and closes the previous bitmap (`replaceContact`); a detection-free frame leaves `contact` untouched, so the contact card lingers through the meter's decay tail instead of vanishing the instant police drop out of frame. A crop paired with a detection that fails `toRoadDetections`'s validation (mirroring the road filter) is closed and discarded rather than shown. In debug mode, a detection-free scan instead arrives with the worker's `frameThumbnail` and replaces `contact` with a bare **frame preview**: the thumbnail `image`, the optional `frame`, and `at`, with the `score`/`signal`/`box`/`direction` detection fields absent (they are optional on `Contact`). This is what shows a thumbnail on every scan in debug mode. `contact` is cleared, closing its bitmap, on a `worker-error`/`onerror` and on provider teardown.

`frame`, when present, is the full inference frame (the one the crop was cut from, or the whole frame a preview thumbnails), JPEG-encoded by the worker for debug-mode frame saving (see Worker protocol below); it carries no `close()` lifecycle of its own, unlike the crop bitmap, and is left for garbage collection. `DetectionProvider` reads `useSettings().showDebug`, mirrors it into a ref so `sendFrame` can read the current value without resubscribing, and sends `includeFrame: true` with every `detect` request while it's on; this is why `App.tsx` renders `DetectionProvider` inside `SettingsProvider` rather than the other way around. `RadarDetectorScreen`'s contact card shows a SAVE button, downloading `frame` as a timestamped JPEG via `src/lib/saveFrame`, only while its `debug` prop is on and `frame` is present.

**Crash sentinel heartbeat** (`src/lib/crashSentinel`). iOS sometimes kills the page mid-scan (a jetsam event); no JS runs at kill time, so Sentry never observes it directly. A `framesTotalRef` counter increments once per `detections` message (in the handler body, never a `setState` updater). A separate effect keyed on `[status]` alone writes a heartbeat (`writeHeartbeat`) to localStorage the instant `status` becomes `"running"` and every `HEARTBEAT_INTERVAL_MS` after (5 s), recording `startedAt`, `lastBeatAt`, `framesProcessed` (relative to a baseline captured when the effect starts), `backend`, `graphCapture`, and `release` (the writing build's `APP_RELEASE`, which the safe-mode arming decision requires to match its own, §2); its cleanup runs the clean-end path: clear the record (`clearSentinel`) and reset a below-threshold safe-mode crash streak (`resetWebGpuCrashStreak`, §2). `backend` and `graphCapture` are read from mirror refs inside the interval rather than being effect deps, so the periodic worker recycle (which re-posts `backend-probe`) can't tear the effect down and restart it, which would reset `startedAt` and the frames baseline mid-session and destroy the uptime the sentinel exists to collect. Because the pump already leaves `"running"` on page-hidden, settings-open, and user `stop()`, every normal exit clears the sentinel by construction. A `pagehide` listener registered for the effect's lifetime also runs the clean-end path synchronously: React never flushes effect cleanups during unload, so a plain reload or navigation away mid-scan would otherwise orphan the record and be misread as a crash at the next launch (wrongly counting toward the WASM safe mode, §2; the `autoUpdate` service worker reloads every open session on deploy, so this is a routine path, not an edge case). A real OS kill fires no pagehide, so only it leaves a stale record behind; a page restored from the bfcache rewrites the record on the next interval tick. At the next launch, `readPreviousSessionEnd()` (called once at the top of `src/instrument.ts`, before Sentry initializes and outside the Do Not Track gate so the record is always consumed) reads and removes the stored record and classifies it: a gap since the last heartbeat within `CRASH_RELAUNCH_WINDOW_MS` (60 s) is a `"crash"` (iOS auto-relaunches a killed foreground tab within seconds), a longer gap is `"unclean"` (battery death, manual restart, deliberate shutdown). A non-empty result is reported via `Sentry.captureMessage("Previous session terminated while scanning")` inside the DNT gate, with `level` `"error"`/`"warning"` for crash/unclean, `tags: { sessionEnd, backend, graphCapture, sentinelRelease }` (`sentinelRelease` is the build that wrote the record; it differs from the event's own release tag when a deploy landed in between), and `extra: { gapMs, uptimeMs, framesProcessed }`.

Status transitions: the provider posts `{ type: "load" }` to the worker once, regardless of whether `start()` has been called yet. In production the load message is deferred until a service worker controls the page (`waitForServiceWorkerControl`, `src/lib/serviceWorker`, bounded by `SW_CONTROL_TIMEOUT_MS`) so the first-visit model download flows through Workbox's runtime cache instead of racing ahead of it (see §7); in dev, which has no service worker, it posts immediately. `loading-model → ready` happens when the worker replies `ready` and `start()` hasn't run; `loading-model → running` (skipping `ready`) happens when the worker replies `ready` and `start()` already ran. `ready → running` happens on `start()`. `running → ready` happens on `stop()`. Any worker error or worker crash moves to `error` from any state; there is no in-app path back out of `error`. `ErrorScreen`'s "TRY AGAIN" button does a full `window.location.reload()`.

### Detection loop (frame pump)

1. `App`'s `RadarScreen` calls `start(video)` once the feed component reports a live `<video>` element: `CameraView` normally, or `DevVideoView` in dev video mode (§4.3).
2. The pump (`sendFrame`, in `DetectionContext`) bails if detection isn't running, there's no video/worker, the current worker hasn't reported `ready` yet (`workerLoadedRef`, false from spawn until the ready message, so a frame is never posted to a model-less worker mid-recycle), or a frame is already in flight (`inFlightRef.current > 0`). Otherwise it waits for the camera to present a new frame (`waitForNextVideoFrame` in `src/lib/camera`, built on `video.requestVideoFrameCallback`; resolves immediately on browsers without rVFC), re-checks the guards (the wait can outlive a `stop()`, and rVFC never fires while the page is hidden), then captures `createImageBitmap(video)`, increments `inFlightRef`, and posts `{ type: "detect", frame, includeFrame }` with the bitmap **transferred** (zero-copy) to the worker; `includeFrame` mirrors the `showDebug` setting (read from a ref so the pump doesn't resubscribe on toggle), asking the worker to also return the full frame for debug-mode saving. Gating the capture on a new camera frame guarantees inference never runs twice on the same frame, even if the detection rate outpaces the camera (e.g. very low light dropping the camera's frame rate below the pacing floor).
3. The worker draws the frame onto a 512x512 `OffscreenCanvas`: by default the largest centered square of the bitmap (`centerCropRegion`, matching the Fill-with-center-crop resize the model trains with), or the whole bitmap squished onto the square when the request set `centerCrop: false` (the debug-only comparison mode for models trained on stretched data). It reads back `ImageData` and `preprocess`es it (`src/workers/detection/inference.ts`) into the model's `[1,3,512,512]` NCHW ImageNet-normalized float32 input tensor. It runs `session.run`, then `decodeDetections` applies a per-query sigmoid, thresholds at `CONFIDENCE_THRESHOLD`, and converts the cxcywh boxes to normalized xyxy `RawDetection[]`; under center crop each box is then remapped from crop coordinates to full-frame coordinates (`mapCropBoxToFrame`), so every downstream consumer works in one coordinate space regardless of mode. The bitmap is `close()`d in a `finally` regardless of outcome.
4. On the `detections` reply, `DetectionContext` decrements `inFlightRef`, runs `toRoadDetections` (`src/lib/detection`), passes the result through the `detectionTracker` coasting smoother (§5), then `buildHudModel` (`src/lib/detection`) to produce the `HudModel` the UI renders, records a result timestamp for the FPS estimate, and either recycles the worker (§6a) or re-primes the pump via `schedulePacedFrame`.
5. **Backpressure**: only one frame is ever in flight; the next capture is sent only once the previous result returns (latest-wins, no queue), so detection never runs faster than the device can sustain and never blocks the video element.
6. **Pacing**: `schedulePacedFrame` keeps captures at least `MIN_FRAME_INTERVAL_MS` (2000 ms, so detection runs at most once every two seconds) apart and always rests at least `PACING_REST_RATIO` (0.5) of the last result's round trip before the next capture. The interval between captures is therefore `max(2000 ms, 1.5 x round trip)`. On devices whose round trip is under about two thirds of the floor, the floor dominates: the result schedules the next capture on a timeout for the remainder of the interval, so the GPU idles between frames rather than running inference back-to-back and thermal-throttling a dash-mounted phone. On slower devices the rest ratio takes over: a 3 s round trip is followed by at least 1.5 s of idle, capping the inference duty cycle at roughly two thirds instead of letting slow phones run the GPU flat out (which compounds, since sustained throttling makes inference slower still). The two-second floor is set conservatively on purpose: thermal throttling and battery drain are the app's dominant operational risk, since it runs continuous heavy inference on a phone often clamped to a windshield in direct sun for a whole drive, and a device cooked into throttling or an early shutdown fails the driver exactly when they are relying on it. The coasting tracker (§5) and the peak-hold meter cover the gaps between results, keeping a detection's signal alive on screen without needing every frame confirmed, which is what makes the slower scan rate acceptable. Do not lower the floor to chase detection latency without on-device heat and battery testing on a real dash-mounted phone. A development-only escape hatch (the `throttleInference` setting off, effective only while the `developerOptions` master switch is also on) drives this delay to 0 instead of the floor or the rest ratio, so a plugged-in desktop can run inference flat-out; turning Developer options off always restores the floor, so the phone thermal defaults above are never silently removed. The pacing timer is cleared on `stop()`, worker errors, and provider teardown so a stale timer can't pump a stopped session.
6a. **Periodic recycle**: `workerCreatedAtRef` records `performance.now()` when each worker is created. On a `detections` reply where the pump is running and the worker has been alive at least `WORKER_RECYCLE_AFTER_MS` (900 000 ms, 15 min), step 4 recycles the worker instead of pacing the next frame: it terminates the old worker, bumps `pumpGenerationRef`, resets `inFlightRef` to 0, clears the retry and pace timers, and spawns and loads a fresh worker through the same `spawnWorker`/`requestLoad` helpers used at mount (on a recycle the service worker already controls the page, so the deferred load resolves immediately). This runs at a result boundary where nothing is in flight, so no frame is lost; `status` stays `running` and the new worker's `ready` re-primes the pump through its normal handler (`runningRef` is true). Recycling bounds native memory that JS cannot observe or free (ORT arenas, GPU buffer pools, WASM heap) and grows over thousands of runs until iOS kills the page near its memory cap, the primary crash mitigation for multi-hour scanning sessions. The recycled worker's weights load from CacheStorage (`fromCache: true`), so no download UI flashes; if the cache was evicted, the normal download-progress UI showing is correct. A `readyTrackedRef` guard fires the one-time `backend_resolved`/`model_ready` analytics only on the first `ready` of the page load, so a recycle every 15 minutes does not re-fire them (§4.2).
6b. **Camera-stall recovery**: the same `detections` reply (step 4) feeds three independent stall detectors, all calling `beginRecovery()`. Another app can take over the rear camera (e.g. opening the Android camera app), leaving dashradar's hidden `<video>` presenting frozen or black frames; the handler compares each reply's `fingerprint` (Worker protocol below) against the previous one (`lastFingerprintRef`) and counts a streak (`staleFrameCountRef`), recovering once it reaches `STALE_FRAME_THRESHOLD` (5, about ten seconds at the ~0.5 fps pacing floor). A third detector catches a physically obscured lens, which presents a noisy near-black feed with a changing fingerprint every frame (sensor noise defeats the streak above) but no bright pixels anywhere: the handler compares each reply's `brightFraction` (Worker protocol below) against `DARK_BRIGHT_FRACTION` and counts a streak (`darkFrameCountRef`), recovering with reason `obscured` once it reaches `OBSCURED_FRAME_THRESHOLD` (5, also about ten seconds at the ~0.5 fps pacing floor). Only changing frames count toward this streak; a byte-identical frame clears it and is left to the fingerprint detector, so a solid-black frozen feed is tagged `frozen`, not `obscured`. Keying on the absence of any bright pixel, not average darkness, keeps a dark night scene, which always keeps some lit region, from tripping it. A full stall (`requestVideoFrameCallback` stops firing, so no result ever returns) is caught by a watchdog timer (`WATCHDOG_MS`, 15 s) armed on `start()`, on the `ready` handler's running branch, and on every live result; its callback checks `runningRef`/`workerLoadedRef` before recovering, so a paused pump or the periodic recycle's load window (step 6a) never false-fires it. `beginRecovery()` is re-entrancy-guarded (`recoveringRef`): it clears the watchdog, resets all three detectors, `stop()`s the pump, and either gives up (once `reconnectAttemptsRef` reaches `MAX_RECONNECT_ATTEMPTS`, 3, failed recoveries) by setting `cameraStalled` true, or bumps `cameraEpoch`, the state counter `App` uses to key `<CameraView>` so React remounts it and re-runs `getUserMedia`. The fresh stream's `start()` clears the guard and resets the detectors; `RECOVERY_HEALTHY_FRAMES` (5) consecutive changing frames reset `reconnectAttemptsRef` to 0, so an isolated stall long ago doesn't push a later, unrelated stall to the terminal alert. Recovery is silent: nothing is shown to the driver while it runs, so the in-flight state is `recoveringRef` alone, with no React state and no overlay. Every detected stall (past the re-entrancy guard) fires `track("camera_stall", { reason })`, where `reason` (`CameraStallReason`) is `frozen` for the fingerprint streak, `obscured` for the dark-frame streak, or `watchdog` for the timer, so both the transient stalls a remount fixes and the terminal give-up are counted. When recovery gives up, `cameraStalled` is terminal: rather than reloading the page in a loop (useless against an obscured or failed lens), `App` renders the `CAMERA_STALLED` `ErrorScreen` (a `CameraOff` icon plus copy asking the driver to clear the lens and reload), whose reload button is the only exit, and an additional one-time `track("error", { code: "CAMERA_STALLED" })` records the unrecoverable stall on its own. A `getUserMedia` failure during recovery flows through the existing camera `onError -> ErrorScreen` path unchanged. All of it, the watchdog included, is switched off outright in dev video mode (§4.3): a paused or scrubbed file legitimately stops or repeats frames, exactly what these detectors exist to catch on a real camera feed.
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
| `load` | `forceWasm?: boolean` | Download the ONNX weights and create the `InferenceSession`; posted once per worker (mount and each recycle), deferred until the service worker controls the page in production (see §7). `forceWasm: true` (the WASM safe mode, §2) skips the WebGPU probe and loads the int8 wasm build; carried on the message because the worker cannot read localStorage |
| `detect` | `frame: ImageBitmap` (transferred), `includeFrame?: boolean`, `centerCrop?: boolean` | Run one frame through the model; `includeFrame` asks for the full frame back on the response for debug-mode saving; `centerCrop` (default true when omitted) selects center-crop vs squish preprocessing (§4 step 3) |

`WorkerResponse` (worker → main thread):

| Message | Payload | Purpose |
| --- | --- | --- |
| `model-load-start` | `fromCache: boolean` | Sent once per backend attempt before the weights are read, `fromCache: true` when `caches.match` finds them in the `"model-cache"` route. `DetectionContext` sets `downloadingModel` to `!fromCache` so the download-progress screen shows only for an actual network download, not the fast cache read (which still spends a beat compiling the ONNX session) |
| `model-progress` | `progress: { file, loaded, total }` | One tick per streamed chunk while `fetchModel` downloads the weights (byte counts from the `Content-Length` header); `DetectionContext` sums into a single `ModelProgress`. Not sent on a cache hit, since the bytes are read from CacheStorage in one shot with no download to report |
| `backend-probe` | `probe: BackendProbe` | Sent once alongside `ready` (or the load failure): how far the WebGPU probe got (`workerGpu`/`adapter`/`device`/`shaderF16`), the chosen backend, the WebGPU session error if it fell back, graph-capture state (`graphCapture`/`graphCaptureError`, §4.1.1), `crossOriginIsolated`, and the configured WASM thread count. Feeds the debug overlay only |
| `ready` | `backend: "webgpu" \| "wasm"` | Session finished loading; starts the frame pump immediately if `start()` already ran, otherwise moves to `"ready"` |
| `detections` | `detections: RawDetection[]`, `timing: { preprocessMs, inferenceMs, decodeMs }`, `crop?: { image: ImageBitmap, detectionIndex: number }`, `frameThumbnail?: ImageBitmap`, `frame?: Blob`, `fingerprint?: number`, `brightFraction?: number` | Decoded output for one frame, boxes normalized 0-1 (xyxy), the worker's own per-stage timing for the debug overlay, an optional cutout of the frame's highest-scoring detection, an optional downscaled thumbnail of the model's square input sent in debug mode when there was no detection to crop, an optional JPEG of the full frame when the request set `includeFrame`, a content fingerprint of the decoded frame for camera-stall detection, and the fraction of the frame's subsampled pixels bright enough to rule out an obscured lens |
| `worker-error` | `code: DetectionErrorCode` | `MODEL_LOAD_FAILED` from the download or session creation failing, or `INFERENCE_FAILED` from a per-frame inference failure |

`WORKER_CRASHED` is a third `DetectionErrorCode` value, but the worker never posts it as a `worker-error` message: it's set directly by `DetectionContext`'s `worker.onerror` handler on the main thread, for an uncaught exception in the worker that its own try/catch didn't handle.

`crop`, when present, is a cutout of the frame's highest-scoring detection (`topDetectionIndex`), the evidence the radar-detector screen's contact card shows. `cropRect` (`src/workers/detection/inference.ts`) pads the detection's box by `CROP_PADDING` (15%) per side for context, clamps to the frame, and downscales, never upscales, so the long edge is at most `CROP_MAX_EDGE` (320px); the resulting `ImageBitmap` is cut from the exact frame inference ran on and **transferred**, not cloned, alongside the rest of the message. `detectionIndex` points back into that same message's `detections` array so the receiver can pair the crop with its score and box. Cropping is best-effort: a degenerate rect (under a pixel on either axis) or a `createImageBitmap` failure just omits `crop` from the message rather than failing the whole detection result.

`frameThumbnail`, when present, is a downscaled `ImageBitmap` of the model's square input, sent only in debug mode (`includeFrame`) on a scan that had **no** top detection to crop. `createFrameThumbnail` (`src/workers/detection/index.ts`) resizes the 512x512 input canvas (not the original frame, so the thumbnail shows exactly what the model saw, including the aspect squish of the stretch-to-square preprocessing; the `frame` JPEG for saving remains the unsquished original) to at most `CROP_MAX_EDGE` (320px, never upscaled, matching the crop's sizing) and, like the crop, is **transferred** rather than cloned. It is mutually exclusive with `crop`: a frame with a top detection sends `crop` instead. This is what lets the contact card show what every scan saw in debug mode, not just the scans that detected something. Best-effort like the crop: a `createImageBitmap` failure just omits it.

`frame`, when present, is the full inference frame encoded as JPEG (`FRAME_JPEG_QUALITY` 0.92, `OffscreenCanvas.convertToBlob`), for debug-mode frame saving. `encodeFrame` (`src/workers/detection/index.ts`) draws the frame onto a fresh `OffscreenCanvas` sized to match it and encodes that canvas; the worker calls it on every request that set `includeFrame`, so the card's SAVE button works beside both a detection crop and a no-detection frame thumbnail (a missed-detection frame is exactly the kind worth saving as training data). Best-effort like the crop: an encode failure just omits `frame` from the message. Unlike `crop`, `frame` is a `Blob` and is sent structured-cloned rather than transferred, since only the crop bitmap needs the zero-copy handoff. The encode happens inline within the same `detect` call, so round-trip timings reported with debug on include it whenever `includeFrame` is set.

`fingerprint`, present on every `detections` reply in production (optional in the type since jsdom-based tests can inject a fake worker that omits it), is `frameFingerprint` (`src/workers/detection/inference.ts`): a 32-bit FNV-1a hash over a strided subsample of the decoded 512x512 RGBA frame (`FINGERPRINT_STRIDE`, `consts.ts`), computed from the same `ImageData` already read back for preprocessing, so it adds negligible per-frame cost. Two live camera frames practically never collide, since sensor noise perturbs every frame, while a frozen or black feed produces a byte-identical buffer and thus an identical fingerprint. `DetectionContext` uses a streak of identical fingerprints to detect a stalled camera feed (step 6b of the frame pump above).

`brightFraction`, present on every `detections` reply in production (optional in the type since jsdom-based tests can inject a fake worker that omits it), is `frameBrightFraction` (`src/workers/detection/inference.ts`): the fraction (0..1) of a separately strided luma subsample of the decoded frame (`BRIGHT_FRACTION_STRIDE`, `consts.ts`) whose luma exceeds `BRIGHT_LUMA_THRESHOLD` (48), computed from the same `ImageData` already read back for preprocessing. A physically covered lens is uniformly near-black (its measured brightest pixel is around luma 21) and has no bright pixels anywhere, so its `brightFraction` is essentially zero, while a night driving scene always keeps some lit region (headlights, oncoming lights, a streetlight) well above the threshold. `DetectionContext` uses a streak of near-zero `brightFraction` values to detect a physically obscured lens (step 6b of the frame pump above).

Every message crossing the boundary is validated by a type guard (`isWorkerRequest`, `isWorkerResponse`) before being trusted; a malformed message is silently ignored rather than crashing either side.

### Model (`src/workers/detection`)

The detection model is a custom **RF-DETR Small** checkpoint fine-tuned to detect Las Vegas Metro police vehicles, published as ONNX at [`tuxracer/las-vegas-metro-rfdetr-small-t1`](https://huggingface.co/tuxracer/las-vegas-metro-rfdetr-small-t1) and trained/exported from the sibling repo `~/Development/las-vegas-metro-rfdetr-small-t1` (its `CLAUDE.md` documents the export and quantization recipes). `MODEL_URL_BY_BACKEND` (`consts.ts`) streams `onnx/model_fp16.onnx` (mixed precision, ~57 MB) on WebGPU and `onnx/model_int8.onnx` (~31 MB) on WASM, directly from Hugging Face at runtime. All builds share one signature:

- **Input** `input`: `[1,3,512,512]` fp32 NCHW. Fixed 512x512, ImageNet-normalized (`mean=[0.485,0.456,0.406]`, `std=[0.229,0.224,0.225]`); the app fills it with the frame's centered square crop by default (§4 step 3).
- **Output** `dets`: `[1,300,4]` fp32, boxes in cxcywh normalized 0..1.
- **Output** `labels`: `[1,300,2]` fp32, raw class logits (apply sigmoid).

Why raw onnxruntime-web and not the Transformers.js `pipeline("object-detection")`: this checkpoint's head is a single real class scored with a per-query **sigmoid**, with the police class at index 1 (index 0 unused). Transformers.js decodes `rf_detr` with the RT-DETR post-processor (softmax + "last class index is background, skip it"), which drops every real detection, and `RfDetrImageProcessor` isn't a registered JS processor type. So the worker bypasses the pipeline entirely: it does its own ImageNet preprocess and its own sigmoid + cxcywh decode (`inference.ts`). No NMS is applied (RF-DETR is set-based). The graph's output names are read from the session at load time, falling back to the expected `dets`/`labels` if the graph doesn't expose them literally.

### 4.1 WebGPU serves the mixed-precision fp16 build (GridSample stays fp32)

RF-DETR's decoder samples multi-scale features through `GridSample` (3 nodes in this graph), and GridSample precision is the constraint that shaped the WebGPU model choice. The JSEP WebGPU GridSample kernel (the root `onnxruntime-web` import's implementation) generates **invalid WGSL for fp16 tensors**: it emits an `f32 * f16` multiply, which WGSL forbids (no implicit mixed precision), so `CreateShaderModule("GridSample")` fails, the compute pipeline is invalid, and the op silently produces garbage. Because GridSample feeds the decoder, a pure-fp16 build yields broken detections on **every** WebGPU device under JSEP, which is why this app originally served the full-precision fp32 build there (verified at the time: thousands of `Invalid ComputePipeline "GridSample"` errors with fp16, zero with fp32).

Two later changes made fp16 shippable, and it is now what `MODEL_URL_BY_BACKEND` serves on WebGPU. The model repo's v1.5+ `model_fp16.onnx` is a **mixed-precision** export: fp16 weights and compute with the three GridSample nodes kept fp32 behind boundary Casts (GridSample has no weights, so this costs nothing in size), fp32 I/O. And the worker moved to the native C++ WebGPU EP (`onnxruntime-web/webgpu`, §4.1.1), a separate kernel implementation from JSEP. Verified in Chrome via chrome-devtools MCP on the shipped v1.6 build: zero GridSample/WGSL errors, graph capture on, reference-image top score 0.7635 vs the fp32 build's 0.763 (boxes within 0.0001), replay ~20 vs ~25 ms/frame on the same desktop GPU, at half the download (~57 vs ~114 MB). The fp16 build's tensors make onnxruntime-web require the `shader-f16` adapter feature at session creation; `resolveBackend()` gates on it (§2) so unsupported devices go to WASM instead of failing. If a future export changes GridSample precision or the webgpu URL moves to a different build, re-run the verification pass (zero GridSample errors in a real Chrome run, reference-image score matching) before shipping.

### 4.1.1 WebGPU graph capture (on, native WebGPU EP required, excluded on WebKit)

onnxruntime-web's graph capture (`enableGraphCapture: true`) records the model's kernel dispatches on the first run and replays them on later runs, cutting the per-frame CPU overhead of dispatching RF-DETR's hundreds of small kernels (~35 vs ~66 ms/frame in our desktop-GPU verification). It is on via the `WEBGPU_GRAPH_CAPTURE` flag (`consts.ts`), except on WebKit: `loadForBackend` skips the capture attempt whenever `isWebKitUa(navigator.userAgent)` (`src/lib/browserEngine`) is true, because crash-sentinel telemetry (Sentry DASHRADAR-2, iOS Safari 26 on an iPhone, `graphCapture: true`, killed 5 seconds into scanning) implicated capture on WebKit, and capture has only ever been verified on Chrome. WebKit runs a plain WebGPU session, the overlay row reads "disabled", and the sentinel's `graphCapture` tag verifies the exclusion in the field. Lift it only after a re-enabled iPhone survives long scanning sessions with the sentinel quiet. On non-WebKit browsers:

- `createCaptureModel` creates the session with `enableGraphCapture: true` and `preferredOutputLocation: "gpu-buffer"`. A capture session rejects CPU-located IO at `run()`, so the input lives in one persistent `GPUBuffer` (created on the device from `await env.webgpu.device` after session creation, wrapped once via `Tensor.fromGpuBuffer`) written each frame with `device.queue.writeBuffer`, and outputs are read back with `await tensor.getData(true)`.
- A validation-plus-warm-up run happens at load time, on the still-zeroed input buffer. This performs the actual capture, compiles shaders before the first camera frame, and surfaces run-time capture incompatibility (which does not always fail at session creation) while the weights are still in scope, so falling back to a plain WebGPU session is cheap. The fallback stays: capture is unproven on mobile GPUs, and a device where it fails falls back and keeps working.
- The outcome is reported through the backend probe's `graphCapture`/`graphCaptureError` fields and shown in the debug overlay's "graph capture" row (`on`, `failed` plus an error block, `disabled`, or `n/a` on wasm).

Capture requires every graph node partitioned onto the WebGPU EP, and that is why the worker imports `onnxruntime-web/webgpu` instead of the root `onnxruntime-web`. onnxruntime-web 1.27 ships two WebGPU implementations: the root import runs WebGPU via JSEP (TypeScript kernels, `jsep` runtime files), whose kernel registry has no `TopK`; this graph's TopK node is the model's two-stage proposal selection (ReduceMax over the anchor logits, TopK 300, GatherElements seeding the decoder queries), it is staying in the export, and under JSEP it lands on the CPU EP, failing capture deterministically on every device (`... not been partitioned to the JsExecutionProvider`). The `/webgpu` subpath runs the native C++ WebGPU EP (`asyncify` runtime files), which has a TopK kernel; there, capture initializes and replays correctly. Verified in Chrome via chrome-devtools MCP on both the v1.6 fp32 build and the shipped v1.6 fp16 build (§4.1): overlay reads "graph capture: on", zero GridSample/WGSL errors, reference-image top scores 0.763 (fp32) and 0.7635 (fp16) against the model repo's native baseline 0.7635; the same bundle's WASM EP runs `model_int8.onnx` correctly (top score 0.763, boxes matching to under 0.001), so the one import covers both backends. Two operational notes: a residual `Some nodes were not assigned to the preferred execution providers` warning still prints on the native EP and is harmless, and small numeric drift versus old JSEP results (~0.002 confidence, identical boxes) is expected, not a regression. `ORT_RUNTIME_FILES` in `vite.config.ts` must list the asyncify files while the worker uses the `/webgpu` import (§7).

### 4.2 Analytics events

All analytics is anonymous and carries no camera, location, or detection-geometry data (§3). Since the app has no backend, these events are its only telemetry, and the operational ones below are the only view into whether it works on real devices. Dev sessions emit nothing: both the Vercel Analytics `beforeSend` gate (`src/main.tsx`) and the Sentry init gate (`src/instrument.ts`) treat `import.meta.env.DEV` the same as an active Do Not Track signal, so desk testing never pollutes the production event stream.

**Health events**, emitted from `DetectionContext`'s worker-message handlers so they fire once at their source (not from React render or state updaters, which StrictMode double-invokes):

- `backend_resolved` `{ backend }` and `model_ready` `{ backend, fromCache }` both fire on the worker's `ready` message, but only on the **first** `ready` of the page load (gated by `readyTrackedRef`): the periodic worker recycle (§6a) produces a fresh `ready` every 15 minutes, which must not re-fire them. The first captures the WebGPU/WASM split across the device population; the second captures load success and runtime-cache hit rate (`fromCache` is carried from the earlier `model-load-start` message via `modelFromCacheRef`).
- `safe_mode_load` (no payload) fires alongside the first-ready events when that ready happened under the WASM safe mode (§2): the load was posted with `forceWasm: true` after a previous session's detected WebGPU crash. It counts sessions that actually ran degraded, not mere armings, and shares the `readyTrackedRef` gate so worker recycles never re-fire it. Read against `backend_resolved` it gives the fleet-wide fallback rate without opening Sentry.
- `error` `{ code }` fires wherever a failure surfaces to the user. Detection failures are tracked at their origin in `DetectionContext` (the `worker-error` handler with the `DetectionErrorCode`, and `onerror` with `WORKER_CRASHED`); camera failures are tracked in `App.tsx` by an effect on `cameraError`, since `getUserMedia`'s result only reaches the UI there. The `CameraErrorCode` breakdown (permission-denied rate especially) is the app's most valuable funnel signal.
- `pwa_installed` fires once when the app runs as an installed PWA (`src/lib/pwaInstall`, called from `main.tsx`). Two paths feed it, deduped by a `dashradar:pwaInstalled` localStorage flag: Chromium's `appinstalled` event captures the true install moment, while iOS (Safari implements no `appinstalled`, and every install is a manual Add to Home Screen) is caught on the **first standalone launch**, detected via `display-mode: standalone` or the legacy `navigator.standalone`. iOS gives installed PWAs storage isolated from Safari's tabs, so a browsing-session flag never leaks into the installed app and the first standalone launch always looks fresh. Two reading caveats: it counts only installs the user actually launched at least once, and EU iOS 17.4+ can open installed PWAs in a browser tab where standalone detection does not apply.

**Police sighting event.** The `detections` result handler in `DetectionContext` reports an anonymous `police_detected` event when police come into view. It fires on the **leading edge only**: the event is sent the frame police first appear, then stays quiet until police have been absent for `POLICE_EVENT_DEBOUNCE_MS` (`DetectionContext/consts.ts`, 30 s), so following a car continuously (a detection at most once every two seconds, §4 pump) collapses into one event rather than a flood. A sighting after that much absence counts as a fresh encounter and fires again.

The handler keys off the frame's fresh road-filtered detections (any carrying `POLICE_LABEL`), not the coasting tracker's `visible` set (§5), so a briefly held stale box does not keep the debounce alive. `lastPoliceSeenAtRef` holds the `performance.now()` of the last sighting; it starts at `Number.NEGATIVE_INFINITY` (not `0`, which is only ~page-load time and would swallow a sighting in the first 30 s) so the first sighting always reads as fresh. The `track()` call sits in the message handler body, deliberately not inside the `setHud` updater: React double-invokes state updaters under StrictMode, which would double-count the sighting. The event carries no payload: no location, no box, no image, no score, only the count.

### 4.3 Dev video mode (`src/lib/devVideo`, `DevVideoView`)

For testing at a desk, or replaying real dashcam footage to look for false positives and false negatives, without a live camera: `pnpm dev` accepts `DASHRADAR_VIDEO=<path>` to substitute a local video file for the camera feed. `vite.config.ts` resolves the path once at config load (`resolveDevVideoPath`, expanding a leading `~`); a missing file, a path that isn't a regular file, or one without read permission throws immediately, so a bad path fails dev-server startup rather than a request mid-session. The path is only resolved for a genuine dev-server run (`command === "serve"` and not under Vitest); a build, or a test run with a stale `DASHRADAR_VIDEO` left in the environment, always takes the null path below instead of risking the throw.

The `devVideo` Vite plugin (`apply: "serve"`, so it's entirely absent from production builds) serves that file at `/__dev-video`, honoring Range requests (`bytes=a-b`, the open-ended `bytes=a-`, and the suffix `bytes=-n` form, each answered with a `206` and matching `Content-Range`/`Content-Length`) because `<video>` scrubbing only works against a server that supports partial content. A Range header the `bytes=a-b` regex doesn't match is treated as absent and falls through to a plain `200` full-body response; a header that does match but names a range the file can't satisfy (start at or past the file size, or start past end) gets a `416` instead. A read error mid-stream (the file is deleted or its permissions change after the server starts) ends the response instead of crashing the dev server.

`__DEV_VIDEO_URL__` is a Vite `define`: the `/__dev-video` route string when `DASHRADAR_VIDEO` is set for a dev-server run, `null` otherwise, and always `null` in a production build. `src/lib/devVideo` re-exports it as `DEV_VIDEO_URL: string | null`, the one flag the rest of the app reads. Because production always compiles it to `null`, every branch keyed on it (in `App.tsx` and `DetectionContext`, both below) is statically dead code there and gets minified away; `grep -rl "__dev-video" dist/assets` after a production build finds nothing.

`App`'s `RadarScreen` renders `DevVideoView` instead of `CameraView` whenever `DEV_VIDEO_URL` is set, and skips the intro screen outright (its camera-permission framing doesn't apply, and dev sessions shouldn't burn a tap on onboarding), so the radar view loads immediately without marking the intro as seen. Because `CameraView` never mounts, `getUserMedia` is never called: the camera is not requested, and camera errors cannot occur in this mode. `DevVideoView` (`src/components/DevVideoView`) takes `CameraView`'s `onStream`/`onVideoResize` props (but no `onError`, see below) plus `src` and `scanning` (`status === "running"`), and plays the clip on a loop. Unlike `CameraView`'s permanently `opacity-0` element, its `<video>` is the visible UI: rendered with native `controls` in a fixed corner of the screen, so the clip can be paused and scrubbed by hand. This mode only ever runs on a desktop browser, so the player is sized for mouse use, not the dash-mount touch-target rules the rest of the app follows. On mount it reports the element through `onStream` (the same `start(video)` wiring `CameraView` uses) and wires the `resize` listener for `onVideoResize`, without starting playback: the pump tolerates a paused video, since it awaits a promise that simply pends until the first frame presents. Playback itself waits for the first rising edge of `scanning`, so the clip's opening seconds are not consumed while the model is still downloading or compiling, and the player is kept invisible (`visibility: hidden`, keeping the element mounted for the pump) until that same edge, so the load and compile phase shows only the radar backdrop, matching the camera path. Both the start and the reveal are one-shot (guarded by a ref and mirrored state): later `scanning` transitions, such as the settings panel pausing the pump or the page going hidden, never auto-play, auto-pause, or re-hide the clip, since by then it is the user's to control through the native controls. A rejected `play()` on that first start logs to the console instead of surfacing an error: the player is already visible with its native controls by then, so pressing play by hand is the recovery, and a dev-only playback hiccup must never render the driver-facing `ErrorScreen`.

`DetectionProvider` takes a `devVideoMode` prop (default `DEV_VIDEO_URL !== null`) that switches off the whole camera-stall machinery (§6b) for the session: the watchdog is never armed, the frozen and obscured-lens streak detectors are skipped entirely, and `beginRecovery` becomes a no-op, so `camera_stall` analytics never fire either. A file-backed feed legitimately stops advancing while paused and jumps or repeats frames while scrubbed, exactly what those detectors exist to catch on a real camera; left enabled, they would trigger recovery (remounting the player and losing the scrub position) every time the driver, at a desk, hits pause. Everything else runs unchanged: pacing, the debug overlay, the contact card, frame saving, the crash sentinel, and the periodic worker recycle. That's the point: dev video mode runs production detection behavior against canned footage, for testing at a desk and for harvesting false positives and negatives from real dashcam clips.

### `SettingsContext` / `useSettings()`

App-wide display options, persisted to `localStorage` under `dashradar:settings`
and validated on read with `isPersistedSettings`. Five options:

```ts
type SettingsContextValue = {
  developerOptions: boolean;
  toggleDeveloperOptions: () => void;
  showDebug: boolean;
  toggleShowDebug: () => void;
  radarAudio: boolean;
  toggleRadarAudio: () => void;
  throttleInference: boolean;
  toggleThrottleInference: () => void;
  centerCropFrames: boolean;
  toggleCenterCropFrames: () => void;
  settingsOpen: boolean; // ephemeral, not persisted
  openSettings: () => void;
  closeSettings: () => void;
};
```

`developerOptions` (default off) is the master switch for the three
development-only options: `showDebug`, `throttleInference`, and
`centerCropFrames`. `SettingsScreen` renders their rows only while it is on,
and `SettingsProvider` reports all three at their `DEVELOPER_OPTIONS_OFF`
values while it is off, so a tweak left enabled cannot alter a normal drive.
The gate lives in the provider, not in each consumer: `useSettings()` returns
the already-gated effective value, so `DetectionContext` reads a bare
`throttleInference`/`centerCropFrames` and `DebugOverlay` a bare `showDebug`.
The stored values are left untouched while the switch is off, so turning it
back on restores the tweaks rather than resetting them.

`DEVELOPER_OPTIONS_OFF` is a separate constant from `DEFAULT_SETTINGS` because
the two diverge on `showDebug`: its off-switch value is false, but its stored
default is true, so turning Developer options on brings the overlay up with no
second tap while a normal drive never sees it.

`showDebug` gates the `DebugOverlay` panel; it doesn't change what detection
does. It defaults on underneath the master switch, so it is off until
Developer options is turned on and on from that moment. `radarAudio` (default on) gates the radar-detector
screen's beeping audio indicator: `RadarDetectorScreen` feeds the raw signal
(not the peak-held meter level) to the `lib/radarAudio` beeper when the
setting is on and silence when it's off, so the beeps cut off the instant a
detection is gone while the dial decays smoothly behind them. Beeping while
the dial shows nothing is impossible by construction: the peak-held dial level
is never below the raw signal, and `AUDIO_FLOOR` sits at or above the dial's
`CONTACT_THRESHOLD`, so any audible level has already flipped the dial to
ALERT. `throttleInference` (default on) drops the pacing floor when off, so it
only ever matters while `developerOptions` is also on and turning that switch
off always restores the floor regardless of the stored value (§4, Pacing).
`centerCropFrames` (default on) selects the worker's preprocessing: on sends
the model the frame's largest centered square crop, matching the
Fill-with-center-crop resize the model trains with; off squishes the whole
frame onto the square input instead, a comparison mode for models trained on
stretched data. Squish is gated the same way, so normal use always runs the
center-crop default regardless of a stale stored value (§4 step 3).
`SettingsProvider` wraps the app outside `DetectionProvider`;
`SettingsButton` (a gear in `StatusBar`) opens the full-screen
`SettingsScreen`, which is the only UI that writes any of these options.

`isPersistedSettings` validates a `Partial<Settings>` shape: each known field
is optional-but-typed, so a stored blob is accepted even if it predates a
newer field (or a future build removes one) and `loadSettings` fills any
missing field from `DEFAULT_SETTINGS`. A corrupt value (not JSON, not an
object, or a field with the wrong type) falls back to `DEFAULT_SETTINGS`
entirely. This is what keeps loading a stored blob predating a field from
wiping out the other, already-stored value.

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

`CONFIDENCE_THRESHOLD` is `0.5`. It's applied twice: once in the worker's `decodeDetections` (a query is emitted only when `sigmoid(policeLogit) >= CONFIDENCE_THRESHOLD`), and again defensively in `toRoadDetections` (`candidate.score < CONFIDENCE_THRESHOLD` is dropped) so a low-confidence result can never slip through. `SIGNAL_FLOOR` (`src/lib/radarSignal/consts.ts`), the score the radar-detector-style meter treats as zero signal, is also `0.5` and is meant to move in lockstep with `CONFIDENCE_THRESHOLD`: since the road filter already drops anything below the confidence threshold, the meter would otherwise waste part of its range on scores that can never reach the HUD.

### Coasting tracker (`src/lib/detectionTracker`)

`src/lib/detectionTracker` sits between `toRoadDetections` and `buildHudModel`. It shows each road-filtered detection right away and only smooths flicker: when the model drops an object for a frame or two, the tracker keeps its last box on screen so it doesn't blink off. Pipeline position:

```
worker → toRoadDetections (confidence >= 0.7) → detectionTracker (coast on miss) → buildHudModel
```

The module is React-free and stateful, split into a pure step function and a stateful wrapper around it: `stepTracker(state, detections, config)` runs one frame and returns the next `TrackerState` plus the `visible` detections; `createDetectionTracker()` wraps it in a small factory exposing `.update(detections)`, which is what `DetectionContext` calls once per frame (§4). `initialTrackerState()` gives an empty starting state, and `iou(a, b)` is the shared intersection-over-union helper both the tracker and its tests use.

Each frame, `stepTracker` greedily matches this frame's detections to existing tracks by IoU (`IOU_MATCH_THRESHOLD`, `0.3`), picking each track's best available match above the threshold, then applies these rules:

- A **matched** track adopts the new detection's box outright but eases its score toward the new raw value by `SCORE_SMOOTHING_ALPHA` (`0.5`) instead of replacing it, and resets its miss count. It stays visible. The blend averages out per-frame model score jitter (which the radar-detector-style meter's `SIGNAL_FLOOR` remap would otherwise amplify roughly 3x into large percentage swings) while a brand-new track still shows its first score unsmoothed.
- An **unmatched** track coasts through up to `MAX_MISSES` (`2`) consecutive frames with no match before it is dropped, keeping its stale box and score, so the box doesn't flicker off when the model briefly loses the object for a frame or two.
- An unmatched detection in the current frame starts a brand-new track that is shown immediately.

Every track is returned as a `visible` detection for `buildHudModel` to shape (there is no confirmation delay). The debug overlay's `detections` row reflects all three pipeline stages, read left to right as `shown / filtered / raw` (`DebugSnapshot.shownCount` / `.filteredCount` / `.rawCount`, §4).

### Nearest object and the NEAR heuristic

`buildHudModel` (`src/lib/detection`) shapes one frame's filtered detections for the HUD:

- **Nearest**: the detection with the largest normalized box area (`(xmax - xmin) * (ymax - ymin)`, clamped to non-negative). There is always at most one nearest detection, and it's excluded from `others`.
- **NEAR flag**: `true` only when the nearest detection's box area is at least `NEAR_AREA_FRACTION` (`0.06`, i.e. the box covers 6% or more of the frame). Retained from the app's earlier bounding-box HUD; nothing in the current radar-detector UI reads it (`hudSignal`, §4, folds `nearest` and `others` together by raw score regardless of this flag).
- **Others**: every other filtered detection. Not shown separately; kept only so `hudSignal` can consider the highest score across every detection in frame, not just the nearest one's.

### Coordinate mapping (`mapBoxToViewport`)

Retained from the app's earlier bounding-box HUD; no current UI calls it, since the camera `<video>` is always hidden and no component draws a box over it. The camera `<video>` still renders with `object-fit: cover` (`src/components/CameraView`): scaled up and center-cropped to fill the viewport. `mapBoxToViewport` reverses that transform for a normalized box:

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

This holds regardless of phone orientation (the same formula crops horizontally in portrait and vertically in landscape, whichever dimension overflows the viewport). If the video's CSS ever changes away from `object-fit: cover`, this function's scale/offset math would have to change with it, or a future consumer's boxes would drift off their objects.

---

## 6. Visual Design (radar-detector-style instrument)

A single, opaque, full-screen instrument is the entire UI: the camera feed itself is never shown (`CameraView`'s `<video>` renders permanently `opacity-0`; `RadarBackdrop`'s static radar-grid layer is the only thing ever visible behind it). Design principle: one glanceable readout communicates signal strength, and words are reserved for what matters (SCANNING/ALERT). **Amber (`#FFB340`, the `--color-hud-amber` token) is the only accent color**; everything else is white/translucent-black on a near-black surface (`#0B0A10`, `--color-surface`). Dark theme only, no light variant and no in-app toggle. Typography is Rajdhani throughout.

- **Radar-detector-style meter** (`RadarDetectorScreen`, the only detection UI, rendered unconditionally once the model has loaded): a tachometer-style arc of radial ladder ticks around a large percentage readout and a SCANNING/ALERT status word, over a faint radar grid with a slow scanning sweep inside the dial. A `requestAnimationFrame` peak-hold/decay loop (§4) writes the lit segment count, their color (green through amber to red via `signalColor`), the readout text, the status word, a central glow, and a pulsing alert ring (once the level crosses `ALERT_THRESHOLD`) straight to the DOM, so smoothness never depends on the detection rate. The same loop feeds the `lib/radarAudio` beeper the raw signal (not the peak-held level) when `radarAudio` is on, so the beeps cut off the instant a detection is gone while the dial's decay tail continues visually.
- **Contact card**: appears beside the dial (right side in landscape, docked below in portrait) whenever `useDetection()`'s `contact` is set: a canvas-drawn cutout of the detection above a direction row (`left`/`ahead`/`right`, no label or percent since the dial already carries the number), the row rendered only while the raw signal is nonzero so a lingering card never shows a stale heading. The card's opacity is driven by the same rAF loop through a `data-contact` attribute, fading in and out with the meter; its visibility is delayed-visibility CSS rather than opacity alone, so it stays clickable through the fade-out and only goes untappable once fully invisible. While the `showDebug` setting is on and the contact carries the full inference frame, the card also shows a SAVE button (`lib/saveFrame`) that downloads that frame as a timestamped JPEG for collecting training data.
- **Status bar** (`StatusBar`, safe-area aware): `DASHRADAR.APP` wordmark top-left; the `SettingsButton` gear top-right. The `GPU · N FPS` / `CPU · N FPS` engine readout lives in the full-screen `SettingsScreen`, not the bar.
- **Debug overlay** (`DebugOverlay`, gated on the `showDebug` setting, so off until Developer options is turned on and on by default once it is): a small monospace panel pinned top-left, below the wordmark. Shows engine + FPS, round-trip/capture/preprocess/inference/decode timing, worker-boundary overhead, shown/filtered/raw detection counts (§5), viewport and video pixel sizes, device pixel ratio, WebGPU availability, model download percent, and a `throttle` row reading `on`/`off` from the `throttleInference` setting. `pointer-events-none` so it never intercepts taps.
- **Model load screen** (`ModelLoadScreen`): same visual language, amber progress bar, byte counters formatted with `Intl.NumberFormat` (one decimal place, decimal megabytes). Delayed `LOADING_INDICATOR_DELAY_MS` (1 second) before appearing, so a fast (already-cached) load never flashes it. Two labeled phases: DOWNLOADING while bytes are arriving, and PREPARING (full bar, pulsing) once the download is complete but the ONNX session is still compiling, so a fast connection that finishes inside the anti-flash delay does not present a bar pegged at 100% under a downloading label.
- **Error screen** (`ErrorScreen`): a full-screen panel keyed by error code (§8), laid out like the intro (stacked in portrait, side by side in landscape) over the radar backdrop. A per-code lucide glyph sits inside static scope rings echoing the intro's animated scope; beside it the wordmark, a short uppercase headline, one or two sentences of body copy, optional labeled reassurance rows (the permission ask gets ON-DEVICE and PRIVATE privacy points), and a large amber "TRY AGAIN" button that does a full page reload.
- **Intro screen** (`IntroScreen`, first open only): a full-screen **portrait-first** intro rendered by `App` in place of the radar screen until dismissed. This is the one deliberate exception to the app's landscape-first rule: a first-time user meets it holding the phone in the hand, before it reaches the mount. The backdrop is `IntroScene`, a three.js wireframe night-drive scene: an amber wireframe grid highway scrolling in perspective under exponential fog, highway-at-night traffic (white headlight pairs streaking toward the camera with motion trails, red taillight pairs receding), and a half-resolution `UnrealBloomPass`, looping a ~9 s detection beat in which a contact with a red/blue light-bar shimmer sweeps the sky band above the copy and a DOM lock-on bracket labeled CONTACT · 94% snaps onto its projected position (written straight to the DOM per rAF frame, no React state; the contact's lane targets an orientation-specific screen fraction via `CONTACT_LANE_NDC_PORTRAIT`/`CONTACT_LANE_NDC_LANDSCAPE`, just right of center in portrait and further right in landscape, clear of the copy in both). `IntroScene` also renders the center legibility scrim, which must paint above the canvas but below the bracket; its rAF loop pauses on `visibilitychange`, `prefers-reduced-motion` gets a single static frame, a failed WebGL context renders nothing so the static `RadarBackdrop` beneath stays visible, and dismissal disposes every GPU resource so the scene costs nothing during scanning. Over it, one centered copy column (anchored below the beat's sky band in portrait via `portrait:pt-[36vh]`, vertically centered in landscape): the wordmark, a "POLICE DETECTION ON YOUR DASH" headline (two lines in portrait, one in landscape), a one-line on-device privacy blurb ("On-device computer vision. Nothing leaves your phone."), and a large amber START button. On a desktop or laptop (`isDesktopDevice` in `src/lib/deviceType`, judged by a fine hover-capable primary pointer) the START button is replaced by the shared `ShareQr` code with a scan-to-continue-on-mobile prompt, since the app is built for a phone on a dash; a small "Continue on this device" link below it still dismisses the intro. Because `CameraView` is not mounted while the intro shows, the camera permission prompt fires right after the START tap instead of cold on page load; the model download still proceeds underneath in `DetectionProvider`. Dismissal is persisted under the `dashradar:introSeen` localStorage flag (`shouldShowIntro`/`markIntroSeen`); when localStorage is unavailable the intro shows again each visit rather than skipping a genuine first open.
- No nav and no dialogs. The only settings surface is the full-screen `SettingsScreen`, opened from the top-bar gear.

---

## 7. Offline & PWA Strategy

`vite-plugin-pwa` generates a Workbox service worker, registered in `src/main.tsx` via `virtual:pwa-register` with `registerType: "autoUpdate"` (silent background updates, no update-available prompt). The manifest (`vite.config.ts`) sets `name`/`short_name` to `dashradar`, `display: "standalone"`, `background_color`/`theme_color` to `#0B0A10`, and points at the icons in `public/` (192, 512, and a maskable 512 variant).

**Two independent caches make the app work fully offline, and each is populated by a different mechanism:**

1. **App shell precache** (Workbox `globPatterns: ["**/*.{js,css,html,svg,png,woff,woff2}"]`, `maximumFileSizeToCacheInBytes: 40_000_000`): every built JS/CSS/HTML/font/icon file, including the detection worker's own chunk. It's built via `new Worker(new URL(...), { type: "module" })`, so Vite emits it as a separate chunk, but that chunk is still matched by the `js` glob and precached like any other script. This is what makes a cold load work with zero connectivity.
2. **Model weights + the ONNX runtime itself**, cached by two Workbox `CacheFirst` runtime-caching routes (`vite.config.ts`):
   - The `"model-cache"` route caches the RF-DETR ONNX weights the worker `fetch()`es from `huggingface.co`. The worker streams the download itself (reading the response body chunk by chunk) to report byte progress, so the weights are not part of the precache glob; the runtime route is what keeps them offline after the first run. The `huggingface.co` `resolve` URL responds with a 302 to a signed, per-request CDN URL, but Workbox keys the cache on the stable `huggingface.co` request URL, so later visits still hit the cache even though the redirect target changes each time. Before fetching, the worker probes this cache with `caches.match(url)` (CacheStorage is shared with the service worker) to tell whether this load is a cache hit or a network download, and reports that as `model-load-start`'s `fromCache`. The match succeeds even though the cached response carries `Vary: origin, access-control-request-method, access-control-request-headers`, because the worker's simple GET and the probe request both omit those headers, so Vary matching treats them as equal.
   - The onnxruntime-web `.wasm`/`.mjs` runtime is served **same-origin** from `/ort/` (the worker sets `env.wasm.wasmPaths` to `/ort/`), not from a CDN. The `ortRuntime` Vite plugin copies the two files the worker's `onnxruntime-web/webgpu` bundle actually fetches (`ort-wasm-simd-threaded.asyncify.wasm` and its `.mjs` glue; the root import would fetch the `jsep` pair instead, so `ORT_RUNTIME_FILES` must track the worker's import, §4.1.1) out of `node_modules` into dev and the build output, and prunes the hashed duplicate Vite would otherwise leave in `dist/assets/`. The `"ort-runtime"` route caches the `/ort/` requests, so the runtime is fetched on first use and available offline afterward (not precached, to avoid front-loading ~24 MB into the service-worker install). Serving it same-origin is also what lets cross-origin isolation (§7.1) stay on without the runtime needing a cross-origin exemption.

**First-visit caching depends on the worker being controlled.** The model is `fetch()`ed from inside the detection Web Worker. On a genuine first visit the worker can be created and start fetching before the service worker takes control of the page (the `clientsClaim` race), so that first fetch bypasses the `"model-cache"` route entirely and nothing is stored until a later visit. `DetectionContext` therefore defers the worker's `load` message until `navigator.serviceWorker.controller` is set (`waitForServiceWorkerControl`, `src/lib/serviceWorker`), bounded by `SW_CONTROL_TIMEOUT_MS` (3 s) so startup never stalls, and only in production (dev has no service worker). On the dev server the worker caches the weights itself instead: after a network download, `cacheModelInDev` (`src/workers/detection/index.ts`, a no-op in production builds) writes them into a `"model-cache-dev"` CacheStorage cache that the `caches.match` probe finds on the next dev launch, and evicts entries for URLs no longer in `MODEL_URL_BY_BACKEND`, so an unchanged `MODEL_REVISION` loads locally across dev restarts while a bump re-downloads once. `src/main.tsx` also calls `requestPersistentStorage()` (a best-effort `navigator.storage.persist()`) so the browser is less likely to evict the cached weights between visits, which matters most on storage-constrained mobile browsers.

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

### User-facing copy (`AppErrorCode = CameraErrorCode | DetectionErrorCode | AppLevelErrorCode`, `src/components/ErrorScreen/consts.ts`)

Each code maps to structured `ErrorCopy` (`title`, `body`, optional `points` reassurance rows) plus a lucide glyph chosen in the component (`Camera` for the permission ask, `CameraOff` for camera failures, `CloudOff` for the model download, `TriangleAlert` for worker failures).

| Code | Headline | Body copy shown in `ErrorScreen` |
| --- | --- | --- |
| `PERMISSION_DENIED` | CAMERA ACCESS NEEDED | "This app spots patrol vehicles by watching the road through your camera, so it can't run without it. Allow camera access for this site, then try again." Plus ON-DEVICE ("Detection runs entirely on your phone.") and PRIVATE ("No images ever leave your device.") reassurance rows |
| `NO_CAMERA` | NO CAMERA FOUND | "No camera was found on this device." |
| `CAMERA_IN_USE` | CAMERA IN USE | "The camera is in use by another app. Close it, then try again." |
| `UNSUPPORTED` | BROWSER NOT SUPPORTED | "This browser can't access the camera. Try a recent version of Chrome or Safari." |
| `MODEL_LOAD_FAILED` | DOWNLOAD FAILED | "The detection model couldn't be downloaded. Check your connection, then try again." |
| `INFERENCE_FAILED` | DETECTION STOPPED | "Detection stopped unexpectedly. Reload to restart it." |
| `WORKER_CRASHED` | DETECTION STOPPED | "Detection stopped unexpectedly. Reload to restart it." |
| `CAMERA_STALLED` | CAMERA VIEW LOST | "Make sure nothing is blocking the camera, then try again." |

`CAMERA_STALLED` is an `AppLevelErrorCode`: not thrown by the camera lib or the worker, but raised by `DetectionContext` when automatic recovery gives up (see §6b). Every code renders a "TRY AGAIN" button that does a full `window.location.reload()`; there is no soft, in-app retry path.

---

## 9. Testing Strategy

Vitest + Testing Library, **behavior-focused** (verify behavior, not implementation constants, per `CLAUDE.md`). jsdom has no camera, no Worker that can run real code, no WebGPU/WASM, and no layout engine, so the worker, onnxruntime-web inference, the camera, and real rendering are verified separately in a real browser (chrome-devtools MCP) and on-device by the user; unit tests stub or inject those seams:

- **`src/lib/detection`**: the road-class filter and confidence threshold (`toRoadDetections`); the nearest/NEAR heuristic (`buildHudModel`), including the empty-frame case and the exact `NEAR_AREA_FRACTION` boundary; `mapBoxToViewport`'s cover-fit math for square, portrait-crop, and landscape-crop cases (retained as a tested pure helper; unused by any current UI).
- **`src/lib/detectionTracker`**: `iou` against identical, disjoint, and partially overlapping boxes; `stepTracker` showing a detection immediately on its first sighting, coasting a track through `MAX_MISSES` frames before dropping it, keeping one track matched as its box drifts (IoU match), adopting a matched detection's box outright while easing its score by `SCORE_SMOOTHING_ALPHA` (damping alternating score jitter, adopting raw scores at alpha 1, first sighting unsmoothed), and greedily matching two detections to two separate tracks without double-claiming; `createDetectionTracker` holding state across calls.
- **`src/lib/camera`**: constraint building (rear camera requested) and every `DOMException` name mapped to its `CameraErrorCode`, plus the `UNSUPPORTED` path when `mediaDevices` is missing, via `vi.stubGlobal("navigator", …)`.
- **`src/lib/wakeLock`**: acquire/release call the Wake Lock API correctly, re-acquires on a stubbed `visibilitychange` event, stops re-requesting after release, and is a safe no-op when the API is unsupported.
- **`src/lib/serviceWorker`**: `waitForServiceWorkerControl` resolves immediately when the Service Worker API is absent or a controller already exists, resolves on a `controllerchange` event when initially uncontrolled, and resolves via the timeout when control never arrives (fake timers), via `vi.stubGlobal("navigator", …)`.
- **`src/workers/detection`**: `isWorkerResponse` accepts every valid message variant and rejects malformed ones (unknown backend, missing fields, unknown error code); the pure `preprocess` (ImageNet normalization, NCHW layout) and `decodeDetections` (sigmoid thresholding, cxcywh-to-xyxy, class-index-1 selection) helpers in `inference.ts` are tested directly against known inputs.
- **`src/context/DetectionContext`**: the full status machine against an injected fake worker (the `createWorker` test seam), including the one-frame-in-flight invariant across a fast `stop()`-then-`start()` (a regression test for a real race that was fixed), a detection reaching the HUD immediately on its first frame and its box coasting through a frame the model misses it, retrying after a `createImageBitmap` failure, and the FPS calculation staying finite. Because the `load` message is now deferred to a microtask (`import.meta.env.PROD` is false in tests, so it resolves immediately), the "starts loading on mount" test awaits it with `waitFor` rather than asserting synchronously.
- **`src/context/SettingsContext`**: defaults `developerOptions` to `false` (so the effective `showDebug` starts off) and `radarAudio` plus the stored `showDebug` to `true` (so turning developer options on reveals the overlay), toggling any flips it and persists to `localStorage`, a fresh mount restores the persisted values, a partial stored blob (missing a field) is tolerated with the missing field falling back to its default, corrupt or wrong-shaped stored JSON falls back to defaults entirely, every developer option reports its default while `developerOptions` is off, turning `developerOptions` back on restores the stored tweaks rather than resetting them (and they keep persisting through the off period), `settingsOpen` defaults to `false` and toggles via `openSettings`/`closeSettings` without being persisted, and `useSettings` throws when used outside a provider.
- **Components** (RTL): `CameraView` attaches the stream and reports a typed error on failure (stubbing `getUserMedia`) and always keeps the video mounted but visually hidden (`opacity-0`, no visibility prop); `DevVideoView` reports the video element immediately without starting playback, starts playback exactly once on the first `scanning` transition and never again on later ones, stays visible with player controls unlike the hidden camera feed, maps a rejected `play()` to a typed `NO_CAMERA` camera error, and reports updated dimensions on the video's `resize` event; `RadarDetectorScreen` renders the POLICE SIGNAL label and one node per ladder segment, starts idle (zero readout, SCANNING), flips to ALERT once any signal registers, feeds the beeper the raw signal while audio is enabled and silences it the instant the signal drops (ahead of the dial's decay) or when audio is disabled, never beeps at a signal the dial itself doesn't indicate, renders the contact card with the right direction copy (or no card without a contact), drops the direction row as soon as the detection clears while keeping the thumbnail, and shows the SAVE button only when `showDebug` is on and the contact carries a frame, downloading it as a timestamped JPEG on tap; `StatusBar` renders the wordmark and the settings gear and shows no FPS readout; `DebugOverlay` renders nothing when `showDebug` is off and shows the diagnostics panel with the expected FPS/size/count text when it's on; `ModelLoadScreen` stays hidden during the anti-flash delay, then shows byte/percent progress, and switches to the PREPARING label once the download completes; `ErrorScreen` covers every error code with a non-empty headline, body copy, and a glyph, and shows the privacy reassurance rows on a denied permission; `SettingsButton` opens the panel; `SettingsScreen` renders nothing until opened, toggles and persists the audio, developer-options, debug, throttle, and center-crop settings from their respective rows, hides every developer row while `developerOptions` is off and reveals all three once it is on, shows the live engine readout (or a starting placeholder), and closes on the close button or Escape; `RadarBackdrop` renders a non-interactive full-bleed grid behind the feed; `IntroScreen` fires `onStart` from the START button, swaps it for the QR code plus a working "Continue on this device" link on a desktop pointer, and its `shouldShowIntro`/`markIntroSeen` helpers round-trip the localStorage flag; `IntroScene` renders nothing when scene creation fails (jsdom's WebGL-less canvas exercises the real fallback), disposes the injected scene on unmount, and steps a single static frame under `prefers-reduced-motion` (its pure `contactStateAt` timeline is unit-tested directly); `App` shows the intro on first open, then the camera-unavailable error screen end-to-end with a stubbed `Worker` and `navigator`.

Real camera video, real onnxruntime-web inference (both backends), and real layout/visual rendering are verified manually: chrome-devtools MCP against a built preview (`pnpm build && pnpm start`) for the model-load screen, backend detection, first-visit model caching, offline cold-load, and Cache Storage contents; genuine on-device phone testing (sustained FPS against real traffic, both orientations, thermal/battery behavior) is the user's job post-merge, since neither jsdom nor a desktop headless browser has a real dash-mounted camera.

---

## 10. Non-Functional Requirements

- **Offline-first**: fully functional with no network after the first successful model download (see §7). Service worker updates apply silently (`autoUpdate`, no UI prompt).
- **No secrets, no logging of sensitive data** (`CLAUDE.md`): v1 has no secrets and no user data to log in the first place; the camera stream and every detection stay in the tab.
- **`pnpm check` clean** (format, lint, typecheck) before commits.
- **Bundle size**: no date-picker, form, or crypto libraries carried over from the starter; the largest code dependency is `onnxruntime-web` itself, an accepted cost for on-device inference (the model weights are downloaded from Hugging Face at runtime, not bundled). The ONNX runtime `.wasm` (~24 MB, `ort-wasm-simd-threaded.asyncify.wasm`) is served same-origin from `/ort/` (§7) and fetched on first use, not bundled into the app shell or precached; the `ortRuntime` plugin prunes the hashed duplicate Vite would otherwise emit into `dist/assets/`.

## 11. Success Criteria (Acceptance)

1. Opening the app on a phone requests the rear camera and shows the full-screen radar-detector-style meter; the camera feed itself is never displayed.
2. On a WebGPU-capable device, a police detection lights the meter's ladder segments and readout, flips the status word to ALERT, and shows a contact card with the detection's cutout and direction.
3. On a device without WebGPU, the same behavior runs on the WASM fallback, more slowly, with the status bar reading `CPU` instead of `GPU`.
4. Camera permission denial, no camera, camera-in-use, and an unsupported browser each show their own explanatory `ErrorScreen`, never a blank page or an uncaught exception.
5. A model load failure or an inference crash shows an error screen with a working reload action, not a blank page.
6. The screen does not sleep while detection is running, and re-locks/re-acquires correctly around tab visibility changes.
7. After the first successful load, the app cold-loads and runs live detection fully offline.
8. All tests pass and `pnpm check` is clean.
