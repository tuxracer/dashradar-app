# dashradar: Technical Reference

Conventions and non-negotiable gotchas live in [CLAUDE.md](../CLAUDE.md). This document explains how the app is put together and why the odd parts are the way they are. It does not try to describe every file or constant; the source is right there.

**Status:** shipped (v1) · **Owner:** Derek Petersen

---

## 1. What it is

A phone on a dash mount, running object detection on its rear camera, showing a full-screen signal meter styled like a radar detector. The camera feed is never drawn on screen. When something is detected, a small card appears next to the dial with a cutout of what was seen.

Everything runs in the browser: a Vite React SPA with no backend, no accounts, and no network traffic beyond the app shell and the model weights. No frame, box, or score ever leaves the device.

It is a computer-vision detector, not a radar detector. It cannot see radar, LIDAR, or any RF emission.

**Goals**

- Real-time detection on-device, in a Web Worker, so inference never blocks the video element.
- One glanceable readout. Words are reserved for what matters (SCANNING / ALERT).
- Works offline after the model has downloaded once.
- Keeps the screen awake while scanning.
- Stays inside a thermal and battery budget that a phone clamped to a windshield in the sun can actually sustain.

**Non-goals**

- No recording, no detection history, no accounts, no sync, no server.
- No model or backend picker. WebGPU or nothing (see §2).
- No confidence numbers or object counts in the driver-facing UI.

The only state that survives a reload is the cached model weights and a small `localStorage` settings object.

---

## 2. Device support

Target: a modern iPhone on Safari or an Android phone on Chrome, landscape, dash-mounted. Desktop Chrome works and is useful for development.

**WebGPU is required and there is no CPU fallback.** Before anything is downloaded, the worker runs `probeWebGpu()`: it requests a GPU adapter, checks for the `shader-f16` feature, and requests a device. All three have to succeed. If any fails, the app raises a terminal `WEBGPU_UNSUPPORTED` error and never asks for the camera or fetches a single byte of the model.

Why no fallback: the int8 CPU build that used to serve one measured round trips over 10 seconds on an Android phone where WebGPU takes about half a second. A detector that scans the road once every ten seconds misses most of what the car drives past, so shipping it made the app look functional while failing at its only job. Turning the device away is the honest outcome.

Two details worth knowing:

- The probe acquires a real device, not just a `navigator.gpu` existence check, and it runs in the worker scope. Some browsers expose the API on the main thread but not in a worker, and some expose it and then fail to create a device. Either would mean a 57 MB download followed by a failure at session creation.
- The probe is posted as its own message, separately from the model load, because the load waits for service-worker control (§11) and the verdict must not sit behind that wait.

`UnsupportedScreen` renders after the intro and before every camera screen, so everyone sees what the app is for and nobody is asked for access their phone cannot use. It is deliberately not an `ErrorScreen`: nothing here is fixable on the device in hand, so the screen's job is moving the reader to a phone that works. It borrows the intro's composition and leads with the instruction ("Open it on another phone"), with the `ShareTarget` cluster (QR plus Web Share) carrying the handoff.

Copy rules for that screen, enforced by its tests: do not name "browser" or "GPU", do not say "your phone" (most readers are holding the phone that failed), and do not ask for a "newer" phone. The requirement is a GPU feature, so a current budget phone can fail where an older flagship passes.

---

## 3. Stack

| Concern | Choice |
| --- | --- |
| App | Vite 8 (Rolldown) + React 19, TypeScript, ESM, static build |
| Detection | `onnxruntime-web` on WebGPU, in a Web Worker, hand-rolled preprocess and decode |
| PWA | `vite-plugin-pwa` (Workbox): precached shell, runtime-cached weights and ORT runtime |
| Styling | Tailwind CSS v4 on bespoke elements, two color tokens, `lucide-react` for a couple of glyphs |
| Font | Rajdhani via `@fontsource/rajdhani`, the only font |
| Utilities | remeda, including the type guards that validate worker messages |
| Telemetry | Vercel Analytics and Sentry, both gated on Do Not Track / GPC and off in dev |
| Tests | vitest + Testing Library (jsdom) |

Commands are in [CLAUDE.md](../CLAUDE.md). `pnpm check` must pass before a commit.

---

## 4. Architecture

```
App
 └─ DetectionProvider ──► detection worker (RF-DETR on onnxruntime-web, WebGPU)
                            │
                            ▼
                   toRoadDetections (road-class filter, confidence floor)
                            │
                            ▼
                   detectionTracker (coasting flicker smoother)
                            │
                            ▼
                   buildHudModel ──► RadarDetectorScreen
```

Everything below the provider is pure: no React, no DOM. Components read `useDetection()` and never touch the worker.

Inference lives in a worker so the video element keeps running at its native frame rate while detection runs at roughly one frame per second. (WebCodecs was considered and dropped for weak Safari support.)

### Module map

Modules are directories named after their primary export (`index.ts` plus optional `consts.ts`, `types.ts`, `tests.ts`).

**Contexts**

| Module | Owns |
| --- | --- |
| `context/DetectionContext` | Worker lifecycle, the frame pump, status machine, contact and saved-frame state, debug snapshot |
| `context/SettingsContext` | `localStorage`-backed settings behind the developer-options master switch |
| `context/DevVideoContext` | The video file that can stand in for the camera |

**Domain libraries** (all React-free)

| Module | Does |
| --- | --- |
| `lib/detection` | Road-class filter, confidence floor, HUD shaping, retained viewport mapping |
| `lib/detectionTracker` | IoU matching, show-immediately, coast-on-miss |
| `lib/autoZoom` | Picks the next scan's crop factor |
| `lib/radarSignal` | Score-to-signal remap, peak-hold decay, colors, contact direction |
| `lib/radarAudio` | Web Audio beeper whose rate and pitch track the signal |
| `lib/camera` | `getUserMedia` wrapper, typed `CameraError`, rear-camera constraints |
| `lib/crashSentinel` | localStorage heartbeat, next-launch crash classification |
| `lib/scanClock`, `lib/timingHistory` | How long a session actually scanned; rolling round-trip and inference samples |
| `lib/wakeLock`, `lib/serviceWorker`, `lib/pwaInstall`, `lib/resetAppData`, `lib/saveFrame`, `lib/videoFileDrop`, `lib/deviceType`, `lib/appRelease`, `lib/branding` | Small single-purpose helpers, one concern each |

**Components**

`RadarDetectorScreen` is the only detection UI. `CameraView` holds the hidden `<video>`. Around them: `StatusBar` and its optional indicator pills, `SettingsScreen`, `DebugOverlay`, `SaveToast`, `CameraPreview`, the intro and permission and load and error screens, `UnsupportedScreen`, and `ShareTarget` (the QR plus Web Share cluster shared by the desktop intro and the unsupported screen).

`workers/detection` downloads the weights and runs inference. Never import its `index.ts` from app code, it pulls onnxruntime-web along with it; import protocol types from `workers/detection/types` instead.

### What `useDetection()` hands out

Status (`loading-model | ready | running | error`), whether weights are streaming and how far along, the shaped `HudModel`, the current `contact` (the cutout the card renders), the last saved frame, an error code, a camera epoch used to force a `CameraView` remount, `start(video)` / `stop()`, and `getDebugSnapshot()`.

The debug snapshot is deliberately a ref read on demand, not context state. Nothing renders it by default, so pushing per-frame timing through state would re-render every consumer for numbers nobody is looking at. The debug overlay and the round-trip pill poll it a few times a second and keep the value in their own local state.

### Video file feed

A video file can stand in for the camera: drag a clip onto the window, or pick one from the settings row. This is for testing at a desk and for replaying real dashcam footage to hunt false positives and negatives. It ships in production, not just dev. There is no build flag; the feed is chosen at runtime and every session starts on the camera, since a file choice cannot survive a reload.

`DevVideoContext` owns the choice. A file outranks the intro, the permission ask, a camera error, and a stalled camera alike, so a clip loads straight into the radar view in every case. While one is playing, `CameraView` never mounts, so `getUserMedia` is never called and camera errors cannot happen. Clearing the file resets any stale camera error and remounts a clean `CameraView`.

The player is visible in a screen corner with native controls, unlike the permanently hidden camera element, so a clip can be paused and scrubbed. Playback starts on the first rising edge of scanning (so the clip's opening seconds are not consumed while the model compiles) and that start is one-shot: later pauses of the pump never auto-play or auto-pause what the user is now driving by hand.

Swapping the source stops the pump first, synchronously, before the source changes. React runs a child's effects before its parent's, so a stop scheduled after the change would land after the newly mounted player had already started, killing the pump the swap just started.

Everything else runs unchanged: pacing, the overlay, the contact card, frame saving, the crash sentinel, the periodic recycle. The one exception is camera-stall recovery, which is switched off entirely (§5). A file legitimately stops advancing while paused and repeats frames while scrubbed, which is exactly what those detectors exist to catch on a real camera.

---

## 5. The frame pump

1. The feed component reports a live `<video>` element and `App` calls `start(video)`.
2. `sendFrame` bails if the pump is not running, the worker is not loaded yet, or a frame is already in flight. Otherwise it waits for the camera to present a new frame (`requestVideoFrameCallback`), re-checks the guards, captures an `ImageBitmap`, and posts it to the worker, transferred rather than copied.
3. The worker draws the largest centered square of the frame onto a 512x512 canvas (shrunk by the current zoom factor), normalizes it into the model's input tensor, runs the session, decodes and thresholds the output, and maps the boxes back into full-frame coordinates.
4. On the reply, the context runs the road filter, the coasting tracker, and the HUD builder, steps the auto-zoom machine, and either recycles the worker or schedules the next capture.

**One frame in flight, latest wins, no queue.** Detection can never run faster than the device sustains and can never back up.

**Pacing.** Captures are at least `MIN_FRAME_INTERVAL_MS` (1 s) apart, and each one additionally rests `PACING_REST_RATIO` (1) of the last round trip. So the interval is `max(1 s, 2 x round trip)`. On a fast device the floor dominates and the GPU idles between scans. On a slow one the rest takes over, capping the inference duty cycle at 50%, and it is self-correcting: a phone that starts throttling reports longer round trips and buys itself proportionally longer breaks.

This floor is the app's main thermal defense, and the coasting tracker plus the peak-hold meter are what make the slow scan rate acceptable to look at. Do not lower it to chase detection latency without heat and battery testing on a real dash-mounted phone. There is a developer escape hatch (`throttleInference` off) that drops the delay to zero for a plugged-in desktop; turning developer options off always restores the floor.

**Periodic recycle.** Every `WORKER_RECYCLE_AFTER_MS` (15 min), at a result boundary where nothing is in flight, the worker is terminated and respawned. This bounds native memory that JS cannot observe or free (ORT arenas, GPU buffer pools, the wasm heap), which otherwise grows over thousands of runs until iOS kills the page. Weights come back from CacheStorage, so no download UI flashes, and one-time analytics events are ref-gated so a recycle never re-fires them.

**Camera-stall recovery.** Another app can take the rear camera, leaving our hidden `<video>` frozen, and a lens can be physically covered. Three independent detectors catch this, all from the same result handler:

- *Frozen*: a streak of identical frame fingerprints. Live camera frames practically never repeat, since sensor noise perturbs every one.
- *Obscured*: a streak of frames with essentially no bright pixels. Keying on the absence of any bright pixel rather than average darkness is what keeps a night drive, which always has some lit region, from tripping it.
- *Watchdog*: no result at all for `max(WATCHDOG_MS, 3 x last round trip)`. The window has to scale, because pacing puts results about two round trips apart and a fixed window would fire continuously on a slow-but-healthy device.

Recovery is silent: it stops the pump and bumps `cameraEpoch`, which `App` uses as a key on `CameraView` so React remounts it and re-runs `getUserMedia`. After a few failed attempts it gives up and shows the `CAMERA_STALLED` error screen, since reloading in a loop does nothing against a covered lens. All of this is switched off while a video file is the feed (§4), where pausing and scrubbing legitimately stop and repeat frames.

**Pauses.** The pump stops when the page goes hidden and when the settings panel opens (a same-page overlay fires no `visibilitychange`). Each pauser has its own flag and only resumes a session it paused itself, so the two compose without stepping on each other or starting a pump the user never started.

**Race invariants.** One frame in flight (`inFlightRef`), a generation counter that invalidates captures from before a `stop()`, and no side effects inside `setState` updaters (StrictMode double-invokes them). These are hard-won fixes for real races. Read the Gotchas in CLAUDE.md before touching them.

---

## 6. Worker protocol

Both directions are validated by type guards before anything is trusted; a malformed message is ignored rather than crashing either side.

**Main thread to worker**

| Message | Purpose |
| --- | --- |
| `probe` | Can this device run the detector? Downloads nothing. Posted per worker, ahead of and independent of `load` |
| `load` | Download the weights and create the session. Deferred until the service worker controls the page in production |
| `detect` | Run one frame. Carries the transferred bitmap plus per-frame flags: whether to return the full frame (for saving), a thumbnail, a detection cutout, and the effective confidence threshold |

**Worker to main thread**

| Message | Purpose |
| --- | --- |
| `model-load-start` | Whether the weights came from cache. Drives whether the download screen shows at all |
| `model-progress` | Byte counts while streaming. Not sent on a cache hit |
| `model-downloaded` | Weights finished streaming, before the session is built, so a download success is counted separately from a session failure |
| `backend-probe` | How the backend came up: session error, graph-capture state, cross-origin isolation, thread count. Feeds the debug overlay |
| `ready` | Session is live |
| `detections` | Decoded boxes, per-stage timing, and the optional extras: a cutout of the top detection, a thumbnail when there was nothing to cut, a JPEG of the model input, a frame fingerprint, and a bright-pixel fraction |
| `worker-error` | A typed `DetectionErrorCode` plus optional detail text |

Notes on the extras:

- The **cutout** is the evidence the contact card shows: the top detection's box padded for context, clamped, and downscaled (never upscaled), transferred rather than cloned. It is best-effort, and a request can turn it off outright when the driver has the detection image disabled.
- The **thumbnail** is mutually exclusive with the cutout and covers scans that detected nothing, so the card can show what the model saw on every scan.
- The **frame** is the model's square input encoded as JPEG, which makes a saved file directly usable as training data with no re-deriving of the crop.
- The **fingerprint** and **bright fraction** are computed from the pixel data already read back for preprocessing, so they cost almost nothing per frame. Both feed stall detection (§5).

`WORKER_CRASHED` is a `DetectionErrorCode` the worker never posts. `DetectionContext` sets it from `worker.onerror` for an exception the worker's own try/catch did not handle.

**Device loss.** WebKit runs WebGPU in a separate process, and that process can die under a page that is otherwise still running. The worker awaits `device.lost` once per session and turns it into a `GPU_DEVICE_LOST` error, instead of the app noticing one frame later as a generic inference failure and once per frame after that. A `"destroyed"` reason is ignored: that means a deliberate teardown, not a loss.

---

## 7. The model

A custom **RF-DETR Small** checkpoint fine-tuned on Las Vegas Metro police vehicles, published at [`tuxracer/las-vegas-metro-rfdetr-small-t1`](https://huggingface.co/tuxracer/las-vegas-metro-rfdetr-small-t1) and exported from the sibling repo of the same name. The worker streams `model_fp16.onnx` (about 57 MB) from Hugging Face at runtime.

Signature: input `[1,3,512,512]` fp32 NCHW, ImageNet-normalized. Outputs `dets [1,300,4]` (cxcywh, normalized) and `labels [1,300,2]` (raw logits). No NMS, since RF-DETR is set-based.

**Why raw onnxruntime-web and not the Transformers.js pipeline.** This head scores a single real class with a per-query sigmoid, police at index 1. The pipeline decodes `rf_detr` with the RT-DETR post-processor (softmax, last index is background) which drops every real detection, and the matching image processor is not a registered JS processor. So the worker does its own preprocess and its own sigmoid plus cxcywh decode. Any replacement model has to be verified end to end in a real browser; there is no second execution path to catch a bad export.

### Mixed precision, and why GridSample stays fp32

RF-DETR's decoder samples features through `GridSample`, and that op is what shaped the model choice. The JSEP WebGPU GridSample kernel emits an `f32 * f16` multiply for fp16 tensors, which WGSL forbids, so shader creation fails and the op quietly produces garbage. A pure-fp16 build therefore breaks detections on every WebGPU device under JSEP.

The shipped export is mixed precision: fp16 weights and compute, the GridSample nodes kept fp32 behind boundary casts, fp32 I/O. GridSample has no weights, so this costs nothing in file size. Verified in Chrome against the fp32 build: zero GridSample or WGSL errors, matching reference scores, faster replay, half the download.

The fp16 tensors are why the probe gates on `shader-f16` (§2). If a future export changes GridSample precision, re-run that verification before shipping.

### Graph capture

Graph capture records the model's kernel dispatches on the first run and replays them, which cuts the CPU cost of dispatching hundreds of small kernels. It is on everywhere, with no engine check, and falls back to a plain session on any failure.

It requires the native C++ WebGPU EP, which is why the worker imports `onnxruntime-web/webgpu` rather than the root entry point. The root import runs WebGPU through JSEP, whose kernel registry has no TopK; this graph has a TopK node in its proposal selection, so under JSEP that node lands on the CPU EP and capture fails deterministically on every device. `ORT_RUNTIME_FILES` in `vite.config.ts` has to track whichever import is in use, since the two ship different runtime files.

WebKit was excluded for a while after a crash report, and the exclusion was lifted because the data did not support it. It rested on a single event that happened to have capture on; the full issue showed nine of ten iOS crashes had capture *off*. What those crashes actually share is uptime: none survived past about 21 seconds of scanning. That points at startup (shader compilation, first-run allocation, camera acquisition), not at anything capture changes about steady-state frames. Do not re-add an engine check without telemetry that separates capture from the startup window.

### Startup sequencing

Three changes came out of that crash cluster, and they are all about not stacking peaks:

- **The weights buffer is released before the first run**, not after session creation returns. ORT copies weights into its own heap at `create`, so the JS buffer is dead weight exactly as the first run allocates every intermediate at once. Only a cache-backed load releases, since only it can reproduce the bytes for free if the fallback path needs them.
- **The plain session gets a warm-up run** on zeroed input before `ready` is posted, the same one the capture path gets for free. A WebGPU session's first run compiles hundreds of shaders and allocates everything at once; without the warm-up that lands on the first real camera frame, next to a live stream and the frame pump.
- **The camera is acquired after the model, not alongside it.** `CameraView` mounts only once status has left `loading-model`, so `getUserMedia` never fires while the session is compiling. The cost is that the permission prompt now follows the download screen instead of racing it.

---

## 8. Detection domain

### Filter and threshold

The worker emits detections with string labels; only labels in `ROAD_CLASSES` are ever shown, everything else is dropped. The shipped model is single-class and only emits `police`. The remaining COCO entries (car, truck, person, traffic light, animals, and so on) are dormant carryovers, kept so a multi-class model can be swapped in without touching the filter.

`CONFIDENCE_THRESHOLD` is 0.5 and is applied twice: in the worker's decode, and again defensively in the road filter. Both take it as a parameter, which is what lets the developer confidence slider change both at once without a worker reload. `SIGNAL_FLOOR`, the score the meter treats as zero signal, is the same value and is meant to move with it, since the meter would otherwise waste range on scores that can never reach the HUD.

The decode also drops boxes whose shorter edge is under `MIN_BOX_EDGE_PX` of the input, however confident. Below that size a patrol car and a civilian car of the same model are genuinely indistinguishable, so tiny boxes are dominated by false positives. This gate lives only in the decode, where a normalized edge times the input size is exactly the pixels the model saw. Mirroring it on the main thread, where boxes have been remapped to full-frame coordinates, would cancel out the distant-vehicle rescue that zoom exists for.

### Coasting tracker

Sits between the filter and the HUD builder. It shows every detection immediately and only smooths flicker: when the model drops an object for a frame or two, its last box stays on screen instead of blinking off.

Each frame it greedily matches detections to existing tracks by IoU. A matched track adopts the new box outright but eases its score toward the new value rather than replacing it, which damps the per-frame score jitter the meter's floor remap would otherwise amplify into large percentage swings. An unmatched track coasts a couple of frames before being dropped. An unmatched detection starts a track that is visible right away.

The module is a pure step function plus a small stateful factory around it, so the logic is unit-tested directly.

### Auto zoom

The default zoom mode hands the per-scan crop factor to a pure step function, fed the coasted tracker output rather than raw detections so a one-frame flicker cannot release a lock.

- **Nothing detected**: flip to whichever level the last scan was not at. Idle scanning therefore alternates 1x and 2x, covering both fields of view at no extra inference cost. The flip is also how a lock releases, and zooming out first can bring back a vehicle that outgrew the narrow view.
- **Detected at 2x**: hold 2x until the object is gone.
- **Detected at 1x**: go to 2x only if every tracked box fits inside the 2x region with a margin of headroom for movement before the next scan. Otherwise hold 1x, since zooming in would push the thing being watched off the input.

Zoom is a digital crop, never an upscale. `CAMERA_CONSTRAINTS` asks for about 1024 per axis so the 2x crop lands at 512 native pixels. Native camera zoom is not an option: iOS Safari does not expose it and Chrome Android reports device-defined units rather than a multiplier. Gate any new zoom level on the granted stream's real dimensions.

The constraints also cap the frame rate (ideal 15). Detection consumes about one frame per second, but the sensor runs at the granted rate for the whole session, so this roughly halves steady capture power against the 30 fps default. It is not set lower on purpose: auto-exposure stretches shutter time toward the frame period, and long shutters motion-blur exactly the night frames the model needs sharp.

### HUD shaping

`buildHudModel` picks the nearest detection by normalized box area, flags NEAR past an area fraction, and keeps the rest in `others` so the meter can consider the highest score anywhere in frame. The NEAR flag and `mapBoxToViewport` are both retained from the app's earlier bounding-box HUD and nothing currently reads them. `mapBoxToViewport` assumes `object-fit: cover` on the video element; if that CSS changes and something draws boxes again, the math has to change with it.

---

## 9. UI

One opaque full-screen instrument, dark only, amber as the single accent, Rajdhani throughout. Layout is landscape-first, with the intro as the deliberate exception (a first-time user is holding the phone in their hand).

**The meter** is a tachometer-style arc of radial ticks around a percentage readout and a SCANNING / ALERT status word. A `requestAnimationFrame` peak-hold and decay loop writes segment count, color, text, glow, and the alert ring straight to the DOM, so smoothness never depends on the detection rate. The same loop feeds the beeper the *raw* signal rather than the peak-held level, so beeps stop the instant a detection clears while the dial decays behind them.

That loop parks itself once the meter is quiescent, and the prop mirrors wake it on any change. Idle scanning dominates a session, so a loop that ran unconditionally would spend the whole drive rendering a fixed point. While awake, DOM writes are skipped on ticks where nothing changed. Apply the same reasoning to anything new that runs per frame or on a timer.

**The contact card** sits beside the dial in landscape and below it in portrait: a canvas-drawn cutout above a direction row (left / ahead / right), no label or percentage since the dial already carries the number. The direction row only renders while the raw signal is nonzero, so a card lingering through the decay tail never shows a stale heading. Its opacity rides the same rAF loop, and its visibility uses delayed-visibility CSS rather than opacity alone so it stays tappable through the fade-out.

Other surfaces: the status bar (wordmark, settings gear, an optional center slot for the zoom and round-trip pills), the debug overlay, the model load screen (delayed to avoid a flash, with separate DOWNLOADING and PREPARING phases), the error screens, the in-app camera permission ask, and the intro with its Canvas 2D night-drive scene. No nav, no dialogs.

The permission ask exists so the browser's own prompt never lands unexplained: the camera is requested only after its ALLOW CAMERA tap. The intro's dismissal is persisted as a version number rather than a boolean, so bumping that constant walks returning users through a reworked intro once.

---

## 10. Settings

App-wide display options in `localStorage`, validated on read. A corrupt blob falls back to defaults entirely; a partial one fills the missing fields from defaults, so a build that adds a field cannot wipe the values already stored.

`developerOptions` is the master switch. While it is off, `SettingsProvider` reports every developer option at its off value, so `useSettings()` consumers read an already-gated value and never repeat the gate. Stored values are left alone, so turning the switch back on restores the tweaks rather than resetting them.

**Turning the master switch on reveals rows and nothing else.** Every developer option starts at its off value, so a row changes only when someone taps it. Do not add a developer option that defaults on; a driver who opens the switch to look around should not come away with the overlay, the frame encode, or the status pills running. A settings version migration turns off the five options that used to default on.

Two options are driver-facing and are the only rows visible with the master switch off:

- **Audio alerts**: gates the beeper. Beeping while the dial shows nothing is impossible by construction, since the audio floor sits at or above the dial's contact threshold.
- **Detection image** (default on): decides whether a detection puts a card on the glass. Off, it turns the card off end to end rather than hiding a picture that was still produced: the worker is told not to cut a crop, and the context stops exposing one.

The developer rows cover the debug overlay, per-scan frame previews, manual and automatic frame saving, the inference throttle, zoom mode, confidence threshold, the on-glass zoom and round-trip pills, a live camera preview of the scanned region, a raw-score readout, the video file picker, and a reset-app-data action.

Notes on the ones with real behavior behind them:

- **Auto save** downloads a detection's model-input frame with no tap, for collecting training data on a drive. It only fires on scans that actually detected something, since saving every frame would bury the detections and fill the device. It keeps the crop request alive on its own even with the detection image off, so a collection drive can keep the glass clean and still get its files. Each save shows a brief toast, because a browser download is otherwise invisible on a phone and there would be no way to tell a working setup from one silently saving nothing.
- **Camera preview** plays a second video element cropped to exactly the region the model scans, for checking aim on a mount. It defaults off: the app deliberately never shows the feed, and a second live video surface costs compositing on a thermally constrained device.
- **Reset app data** is the one row that stores nothing. Behind a confirm it empties both web storages, deletes every CacheStorage bucket and IndexedDB database, unregisters the service workers, and reloads. Each step settles independently so one failure cannot strand the app half-cleared. It exists to reproduce a genuine first visit on a phone, where reaching for devtools is not an option.

---

## 11. Offline and PWA

Workbox via `vite-plugin-pwa`, registered with `autoUpdate` (silent background updates, no prompt). Two caches make the app work offline, and each is filled by a different mechanism:

1. **App shell precache.** Every built JS, CSS, HTML, font, and icon file, including the detection worker's own chunk (it is emitted as a separate chunk but still matched by the JS glob). This is what makes a cold load work with no connectivity.
2. **Runtime caches**, both `CacheFirst`:
   - `model-cache` holds the weights the worker fetches from Hugging Face. The worker streams the download itself to report byte progress, so the weights are not in the precache glob. The Hugging Face URL 302s to a signed per-request CDN URL, but Workbox keys on the stable request URL, so later visits still hit.
   - `ort-runtime` holds the onnxruntime-web wasm and glue, served **same-origin** from `/ort/` by a small Vite plugin rather than from a CDN. It is fetched on first use rather than precached, to avoid front-loading roughly 24 MB into the service-worker install.

**Model caching pins a revision.** The `model-cache` route is keyed on URL, so the model URL pins an explicit revision, never `main`. To ship a new model: push a new tag, confirm the URL returns 200, then bump the revision constant.

**First-visit caching needs the service worker in control.** The model is fetched from inside the worker, which can start before the service worker claims the page, in which case that first fetch bypasses the route and nothing is stored. So the `load` message waits for `navigator.serviceWorker.controller`, bounded by a short timeout so startup never stalls, and only in production. The dev server has no service worker, so the worker caches the weights itself into a separate dev cache. `requestPersistentStorage()` is also called on startup so the browser is less likely to evict 57 MB of weights between visits.

Verify offline behavior in a real browser: after a fresh load, Cache Storage should hold the precache plus both runtime caches, and an offline hard reload should cold-load the app and run live inference with no network requests.

### Cross-origin isolation

The app is served cross-origin isolated (`COOP: same-origin` plus `COEP: require-corp`), from `vercel.json` in production and the Vite config in dev. That makes `SharedArrayBuffer` available, which is what lets onnxruntime-web run its wasm runtime multi-threaded. Without isolation ORT silently clamps to one thread.

Inference runs on the GPU, but the runtime hosting the WebGPU execution provider is itself a wasm module and runs any node the provider cannot take, so this stays load-bearing. `require-corp` was picked over `credentialless` for Safari support, and it is only viable because nothing needs an exemption: the ORT runtime is same-origin, the model fetch is a CORS request, and analytics is served same-origin. Adding a cross-origin script or a `no-cors` fetch will be blocked.

---

## 12. Telemetry

Everything is anonymous and carries no camera, location, or detection geometry. Dev builds emit nothing: both the analytics gate and the Sentry gate treat dev like an active Do Not Track signal. With no backend, these events are the only view into whether the app works on real devices.

Health and funnel events, all fired from the worker-message handlers at their source rather than from render or state updaters:

| Event | Says |
| --- | --- |
| `intro_start`, `camera_prompt_allow`, `camera_prompt_decline`, `settings_open`, `share_click`, `reset` | Funnel and UI steps. `reset` is also the only thing separating a wiped install from a fresh one |
| `model_downloaded` | Weights finished streaming, with the model slug, revision, and duration. Fires only for a real download, so a rollout can be watched and a download failure told apart from a session failure |
| `model_ready` | The session came up, and whether it came from cache. First `ready` of the page load only, so 15-minute recycles do not re-fire it |
| `first_inference`, `first_round_trip` | The end of the funnel: intro dismissed, permission granted, stream started, model loaded, one frame scored. Cold numbers, next to the warm medians below |
| `timing_round_trip`, `timing_inference` | Medians once a short rolling window fills. The fleet-wide number the pacing floor is argued against |
| `timing_round_trip_late`, `timing_inference_late` | The same pair again after 15 minutes of scanning. The early report is by construction the coldest reading of the drive; the gap between the two is thermal drift on real dash mounts |
| `scan_session` | How long a drive actually scanned, bucketed down, plus whether it ran as an installed PWA. Without it there is no denominator for anything else |
| `camera_stall` | A stall, tagged with which detector caught it |
| `wake_lock_failed` | The screen sleeps mid-drive and the driver has no reason to think anything changed. The app's worst silent failure, and it previously had no telemetry at all |
| `pwa_installed` | Counted from Chromium's install event, or on iOS from the first standalone launch |
| `error` | Every failure that reaches the user, by code |
| `police_detected` | A sighting. Leading edge only, then quiet until police have been absent for a debounce window, so following a car does not produce a flood. No payload at all, just the count |

Timing values are bucketed to the nearest half second, coarse enough that ordinary jitter collapses into one bucket and a series reads as a trend.

**Scan clock.** Both `scan_session` and the late timing report read a clock that measures scanning time, not page time: every pause the app has (settings open, page hidden, stall recovery, feed swap) takes the pump out of `running` and stops it. Reads claim what they report, so stretches over a page's life sum to the total with nothing double-counted or lost.

**Crash sentinel.** iOS sometimes kills the page mid-scan, and no JS runs at kill time, so Sentry never sees it. The app writes a heartbeat to localStorage while scanning (start time, last beat, frames processed, graph-capture state, build id) and clears it on every clean exit, including a synchronous `pagehide` path, since React never flushes effect cleanups during unload and the auto-updating service worker reloads sessions routinely.

Only a real OS kill leaves a stale record. The next launch reads and removes it before Sentry initializes, and classifies it: a short gap is a crash (iOS relaunches a killed foreground tab within seconds), a long one is unclean (battery death, manual restart).

The heartbeat cadence is fast for the first 30 seconds of scanning and slow after. Every field kill so far landed within about 21 seconds of the pump starting, so a flat slow cadence reported only three distinct uptimes across the whole population and could not say where in startup the page died. The fast window expires on its own, so a long drive still pays only the steady rate.

---

## 13. Error handling

Typed error classes with a machine-readable `code`, never string-matched messages.

**Camera** (`getUserMedia` failures, mapped in `lib/camera`):

| `DOMException.name` | Code |
| --- | --- |
| `NotAllowedError`, `SecurityError` | `PERMISSION_DENIED` |
| `NotFoundError`, `OverconstrainedError` | `NO_CAMERA` |
| `NotReadableError`, `AbortError` | `CAMERA_IN_USE` |
| anything else | `NO_CAMERA` |
| `mediaDevices.getUserMedia` missing | `UNSUPPORTED`, thrown before any call |

**Detection**:

| Code | Raised when |
| --- | --- |
| `WEBGPU_UNSUPPORTED` | The GPU probe finds no usable device. Terminal, and raised before any download |
| `MODEL_LOAD_FAILED` | The download or session creation throws. There is no second backend to retry on |
| `INFERENCE_FAILED` | A single frame's inference throws |
| `GPU_DEVICE_LOST` | The GPU process took the device away |
| `WORKER_CRASHED` | An exception the worker's own try/catch did not handle |

`CAMERA_STALLED` is raised by the context when automatic recovery gives up (§5).

Each code maps to a headline, a sentence or two of body copy, an optional set of reassurance rows, and a glyph. Every error screen offers one exit: a full page reload. There is no soft in-app retry.

`WEBGPU_UNSUPPORTED` is deliberately excluded from the type the error screen accepts, so routing it into the generic panel is a compile error rather than a lookup that finds no copy.

---

## 14. Testing

Vitest and Testing Library, behavior-focused. jsdom has no camera, no worker that can run real code, no WebGPU, and no layout engine, so those seams are stubbed or injected and verified elsewhere.

What unit tests cover: the pure detection helpers (filter, threshold, HUD shaping, viewport math), the tracker's matching and coasting, the auto-zoom rules, the camera error mapping, the wake lock, the reset pass, the service-worker wait, the worker's preprocess and decode against known inputs, the message guards, the scan clock, the full status machine and pump invariants against an injected fake worker, and settings persistence and gating.

What is verified in a real browser (chrome-devtools against a built preview): the model load screen, the GPU probe, first-visit caching, offline cold load, graph capture, and reference-image scores after any model change.

What only the user can verify, on-device after merge: real camera video, sustained frame rates against real traffic, both orientations, and thermal and battery behavior on a dash mount.

---

## 15. Acceptance

1. On a phone, the app asks for the rear camera and shows the meter. The feed is never displayed.
2. A police detection lights the ladder and readout, flips the status word to ALERT, and shows a contact card with the cutout and direction.
3. Without usable WebGPU, the intro still plays and the START tap lands on the unsupported screen: no camera prompt, no download, no retry button.
4. Permission denial, no camera, camera in use, and an unsupported browser each get their own explanatory screen, never a blank page.
5. A load failure or an inference crash shows an error screen with a working reload.
6. The screen does not sleep while scanning, and the wake lock re-acquires across visibility changes.
7. After the first load, the app cold-loads and runs live detection fully offline.
8. `pnpm test` and `pnpm check` are clean.
