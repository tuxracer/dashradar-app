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
- **WebGPU when available, WASM fallback otherwise**, chosen automatically with no user-facing setting.

### Non-Goals (v1)

- No video recording, no logging of detection events, no audible alerts.
- No accounts, sync, or server component of any kind. The only state that persists across reloads is the browser's model-weight cache and a small `localStorage`-backed display-settings object (`dashradar:settings`, e.g. the video-feed toggle). There is no IndexedDB and no history.
- No manual model/backend picker and no nav. Settings are a single full-screen panel (video toggle plus read-only engine/model/about), opened from the top-bar gear.
- No object count in the HUD, no confidence scores shown to the user (used internally for thresholding only).

Success criteria: on a phone with WebGPU, smooth video with boxes updating at several detections per second; on the WASM fallback, box updates slow down but the video itself never stutters; the app works offline after the first launch.

---

## 2. Target Platforms & Device Support

Primary target: a phone mounted in landscape on a car dash, orientation unlocked (the overlay math handles either orientation, see §5). Modern iPhone Safari and Android Chrome are the intended runtime; desktop Chrome/Edge work and are useful for development but are secondary.

| Backend | Chosen when | Model build | Notes |
| --- | --- | --- | --- |
| WebGPU | `"gpu" in navigator && navigator.gpu` is truthy (`resolveBackend()`, `src/workers/detection/index.ts`) | `model_fp16.onnx` (fp16 weights, fp32 I/O, ~64 MB) | Faster; verified end-to-end against the shipped model in Chrome via chrome-devtools MCP |
| WASM | No WebGPU (`navigator.gpu` absent), or the browser doesn't expose it | `model_int8.onnx` (int8 dynamic quant, fp32 I/O, ~35 MB) | Universal fallback; the smaller int8 build keeps the CPU path usable |

No WebGPU is not treated as an error: the backend badge in `StatusBar` (`GPU` vs `CPU`) is the only place this is surfaced. There is no manual override.

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
| Analytics | **`@vercel/analytics`** | `inject()` in `src/main.tsx`; page-view analytics only, no camera/detection data. |
| Testing | **vitest** + **@testing-library/react** | jsdom environment; the worker, onnxruntime-web inference, and camera are stubbed or injected (see §9). The pure preprocess/decode helpers are unit-tested directly. |

> **Build note:** `package.json` scripts: `pnpm dev` → `vite`, `pnpm build` → `vite build`, `pnpm start` → `vite preview`. `pnpm test` runs vitest. `pnpm check` runs format + lint + typecheck and must pass before commits.

---

## 4. Architecture & Project Structure

Data flow: `src/App.tsx` → `DetectionProvider` (React context, `src/context/DetectionContext`) → a Web Worker (`src/workers/detection`) running the RF-DETR ONNX model on onnxruntime-web → `src/lib/detection` (pure filtering and HUD shaping, no React, no DOM).

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
    HudOverlay/                 # nearest-object box (amber when NEAR, white otherwise) + floating tag markers
    RadarStrip/                 # lane-radar strip: one blip per detection, amber + larger for the nearest-when-NEAR
    StatusBar/                  # wordmark + settings gear
    SettingsButton/             # enlarged gear that opens the full-screen settings panel
    SettingsScreen/             # full-screen settings panel: video toggle + engine/model/about
    ModelLoadScreen/            # download-progress screen (percent + MB), delayed to avoid a flash
    ErrorScreen/                # full-screen camera/detection error copy + reload action
  context/
    DetectionContext/           # worker lifecycle, frame pump, status machine; consume via useDetection()
    SettingsContext/            # display options (showVideo) + ephemeral settings-open state; consume via useSettings()
  lib/
    camera/                     # getUserMedia wrapper; typed CameraError; rear-camera constraints
    detection/                  # road-class filter, NEAR heuristic, HUD shaping, coordinate mapping (pure)
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
  modelProgress: ModelProgress;             // { loadedBytes, totalBytes }, summed across files
  hud: HudModel | undefined;                // latest shaped detections for the UI to render
  fps: number;                              // rolling detection-result rate
  error: DetectionErrorCode | undefined;
  start: (video: HTMLVideoElement) => void;
  stop: () => void;
};
```

Status transitions: the provider posts `{ type: "load" }` to the worker once on mount, regardless of whether `start()` has been called yet. `loading-model → ready` happens when the worker replies `ready` and `start()` hasn't run; `loading-model → running` (skipping `ready`) happens when the worker replies `ready` and `start()` already ran. `ready → running` happens on `start()`. `running → ready` happens on `stop()`. Any worker error or worker crash moves to `error` from any state; there is no in-app path back out of `error`. `ErrorScreen`'s "TRY AGAIN" button does a full `window.location.reload()`.

### Detection loop (frame pump)

1. `App`'s `RadarScreen` calls `start(video)` once `CameraView` reports a live `<video>` element.
2. The pump (`sendFrame`, in `DetectionContext`) bails if detection isn't running, there's no video/worker, or a frame is already in flight (`inFlightRef.current > 0`). Otherwise it captures `createImageBitmap(video)`, increments `inFlightRef`, and posts `{ type: "detect", frame }` with the bitmap **transferred** (zero-copy) to the worker.
3. The worker draws the bitmap onto a 512x512 `OffscreenCanvas`, reads back `ImageData`, and `preprocess`es it (`src/workers/detection/inference.ts`) into the model's `[1,3,512,512]` NCHW ImageNet-normalized float32 input tensor. It runs `session.run`, then `decodeDetections` applies a per-query sigmoid, thresholds at `CONFIDENCE_THRESHOLD`, and converts the cxcywh boxes to normalized xyxy `RawDetection[]`. The bitmap is `close()`d in a `finally` regardless of outcome.
4. On the `detections` reply, `DetectionContext` decrements `inFlightRef`, runs `toRoadDetections` + `buildHudModel` (`src/lib/detection`) to produce the `HudModel` the UI renders, records a result timestamp for the FPS estimate, and immediately calls `sendFrame()` again.
5. **Backpressure**: only one frame is ever in flight; the next capture is sent only once the previous result returns (latest-wins, no queue), so detection self-paces to whatever the device can sustain without ever blocking the video element.
6. If `createImageBitmap` throws (the video has no frame data yet, e.g. right after attaching), the pump retries after `FRAME_RETRY_MS` (100 ms).
7. `stop()` sets a "not running" flag and bumps a generation counter (`pumpGenerationRef`), so a `createImageBitmap()` capture still in flight from before the stop discards its frame instead of posting it, checked against the captured generation after the `await`.
8. FPS is a rolling average over the last `FPS_SAMPLE_SIZE` (10) result timestamps; a same-millisecond pair of results is skipped rather than producing a divide-by-zero reading.

These invariants (one frame in flight, the generation guard, and keeping frame-sending out of `setState` updater functions so React StrictMode's double-invocation can't double-pump) are hard-won race fixes; see `CLAUDE.md`'s Gotchas before touching this code.

### Worker protocol (`src/workers/detection/types.ts`)

`WorkerRequest` (main thread → worker):

| Message | Payload | Purpose |
| --- | --- | --- |
| `load` | none | Download the ONNX weights and create the `InferenceSession`, posted once on mount |
| `detect` | `frame: ImageBitmap` (transferred) | Run one frame through the model |

`WorkerResponse` (worker → main thread):

| Message | Payload | Purpose |
| --- | --- | --- |
| `model-progress` | `progress: { file, loaded, total }` | One tick per streamed chunk while `fetchModel` downloads the weights (byte counts from the `Content-Length` header); `DetectionContext` sums into a single `ModelProgress` |
| `ready` | `backend: "webgpu" \| "wasm"` | Session finished loading; starts the frame pump immediately if `start()` already ran, otherwise moves to `"ready"` |
| `detections` | `detections: RawDetection[]` | Decoded output for one frame, boxes normalized 0-1 (xyxy) |
| `worker-error` | `code: DetectionErrorCode` | `MODEL_LOAD_FAILED` from the download or session creation failing, or `INFERENCE_FAILED` from a per-frame inference failure |

`WORKER_CRASHED` is a third `DetectionErrorCode` value, but the worker never posts it as a `worker-error` message: it's set directly by `DetectionContext`'s `worker.onerror` handler on the main thread, for an uncaught exception in the worker that its own try/catch didn't handle.

Every message crossing the boundary is validated by a type guard (`isWorkerRequest`, `isWorkerResponse`) before being trusted; a malformed message is silently ignored rather than crashing either side.

### Model (`src/workers/detection`)

The detection model is a custom **RF-DETR Small** checkpoint fine-tuned to detect Las Vegas Metro police vehicles, published as ONNX at [`tuxracer/las-vegas-metro-rfdetr-small-t1`](https://huggingface.co/tuxracer/las-vegas-metro-rfdetr-small-t1) and trained/exported from the sibling repo `~/Development/las-vegas-metro-rfdetr-small-t1` (its `CLAUDE.md` documents the export and quantization recipes). `MODEL_URL_BY_BACKEND` (`consts.ts`) streams `onnx/model_fp16.onnx` on WebGPU and `onnx/model_int8.onnx` on WASM, directly from Hugging Face at runtime. Both builds share one signature:

- **Input** `input`: `[1,3,512,512]` fp32 NCHW. Fixed 512x512, ImageNet-normalized (`mean=[0.485,0.456,0.406]`, `std=[0.229,0.224,0.225]`), bilinear resize.
- **Output** `dets`: `[1,300,4]` fp32, boxes in cxcywh normalized 0..1.
- **Output** `labels`: `[1,300,2]` fp32, raw class logits (apply sigmoid).

Why raw onnxruntime-web and not the Transformers.js `pipeline("object-detection")`: this checkpoint's head is a single real class scored with a per-query **sigmoid**, with the police class at index 1 (index 0 unused). Transformers.js decodes `rf_detr` with the RT-DETR post-processor (softmax + "last class index is background, skip it"), which drops every real detection, and `RfDetrImageProcessor` isn't a registered JS processor type. So the worker bypasses the pipeline entirely: it does its own ImageNet preprocess and its own sigmoid + cxcywh decode (`inference.ts`). No NMS is applied (RF-DETR is set-based). The graph's output names are read from the session at load time, falling back to the expected `dets`/`labels` if the graph doesn't expose them literally.

### `SettingsContext` / `useSettings()`

App-wide display options, persisted to `localStorage` under `dashradar:settings`
and validated on read with `isPersistedSettings` (a corrupt or outdated shape
falls back to `DEFAULT_SETTINGS`). v1 exposes one option:

```ts
type SettingsContextValue = {
  showVideo: boolean;
  settingsOpen: boolean; // ephemeral, not persisted
  toggleShowVideo: () => void;
};
```

`showVideo` controls only presentation. When it is false the camera `<video>`
stays mounted and playing (so the detection pump keeps reading frames) but is
hidden with `opacity-0`, revealing the `RadarBackdrop` grid behind it. The
detection pipeline is never touched by the toggle. `SettingsProvider` wraps the
app outside `DetectionProvider`; `SettingsButton` (a gear in `StatusBar`) opens
the full-screen `SettingsScreen`, which is the only UI that writes the option.

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

`CONFIDENCE_THRESHOLD` is `0.5`. It's applied twice: once in the worker's `decodeDetections` (a query is emitted only when `sigmoid(policeLogit) >= CONFIDENCE_THRESHOLD`), and again defensively in `toRoadDetections` (`candidate.score < CONFIDENCE_THRESHOLD` is dropped) so a low-confidence result can never slip through.

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

- **Nearest object** (`HudOverlay`): the only full bounding box, rounded corners (10px). When flagged NEAR: a 2px amber border with a soft amber glow (`shadow-[0_0_18px_-6px_var(--color-hud-amber)]`) and an amber pill label (`<LABEL> · NEAR`, black text). When nearest but not NEAR (largest box, but under the area threshold): a plain white/85 border and a white-on-black pill label with no "· NEAR" suffix.
- **Other detections**: no box. A floating tag above the object: a rounded pill (translucent black, thin white border, uppercase tracked Rajdhani, no confidence numbers) with a short fading vertical tick pointing down toward the object (offset `TAG_OFFSET_PX` = 30px above the box, clamped so it never goes negative).
- **Lane-radar strip** (`RadarStrip`, the signature glance element): a pill-shaped translucent bar bottom-center (46% of viewport width, minimum 16rem), divided into three lane segments by two faint vertical dividers. One blip per filtered detection, positioned by the object's horizontal box-center fraction. The nearest object's blip is larger (12px) and amber with a glow, but only when the NEAR flag is true; every other blip is a small (8px) white dot. Tells the driver where things are, left/center/right, without reading anything.
- **Status bar** (`StatusBar`, safe-area aware): `DASHRADAR` wordmark top-left; the `SettingsButton` gear top-right. The `GPU · N FPS` / `CPU · N FPS` engine readout now lives in the full-screen `SettingsScreen`, not the bar. No object count is ever shown.
- **Model load screen** (`ModelLoadScreen`): same visual language, amber progress bar, byte counters formatted with `Intl.NumberFormat` (one decimal place, decimal megabytes). Delayed `LOADING_INDICATOR_DELAY_MS` (1 second) before appearing, so a fast (already-cached) load never flashes it.
- **Error screen** (`ErrorScreen`): wordmark, centered error copy keyed by error code (§8), and a "TRY AGAIN" button that does a full page reload.
- No nav and no dialogs. The only settings surface is the full-screen `SettingsScreen`, opened from the top-bar gear.

---

## 7. Offline & PWA Strategy

`vite-plugin-pwa` generates a Workbox service worker, registered in `src/main.tsx` via `virtual:pwa-register` with `registerType: "autoUpdate"` (silent background updates, no update-available prompt). The manifest (`vite.config.ts`) sets `name`/`short_name` to `dashradar`, `display: "standalone"`, `background_color`/`theme_color` to `#0B0A10`, and points at the icons in `public/` (192, 512, and a maskable 512 variant).

**Two independent caches make the app work fully offline, and each is populated by a different mechanism:**

1. **App shell precache** (Workbox `globPatterns: ["**/*.{js,css,html,svg,png,woff,woff2}"]`, `maximumFileSizeToCacheInBytes: 40_000_000`): every built JS/CSS/HTML/font/icon file, including the detection worker's own chunk. It's built via `new Worker(new URL(...), { type: "module" })`, so Vite emits it as a separate chunk, but that chunk is still matched by the `js` glob and precached like any other script. This is what makes a cold load work with zero connectivity.
2. **Model weights + the ONNX runtime itself**, cached by two Workbox `CacheFirst` runtime-caching routes (`vite.config.ts`):
   - The `"model-cache"` route caches the RF-DETR ONNX weights the worker `fetch()`es from `huggingface.co`. The worker streams the download itself (reading the response body chunk by chunk) to report byte progress, so the weights are not part of the precache glob; the runtime route is what keeps them offline after the first run.
   - onnxruntime-web points its `wasmPaths` at `cdn.jsdelivr.net` unless the app sets `wasmPaths` itself (it doesn't), so it fetches its `.wasm`/`.mjs` runtime from jsdelivr rather than from the local bundle. The `"ort-runtime"` route caches those `cdn.jsdelivr.net` requests.

**Known dead weight**: Vite still bundles a copy of the ONNX runtime `.wasm` (~26 MB, `ort-wasm-simd-threaded.jsep.wasm` from `onnxruntime-web`) into `dist/assets/` as a build artifact. It is never fetched at runtime (onnxruntime-web resolves its own jsdelivr URL instead) and is deliberately **excluded** from the Workbox precache glob (no `wasm` extension in `globPatterns`) so it doesn't bloat the service-worker cache for a file nothing ever reads. Verify offline behavior by inspecting the network log and Cache Storage in a real browser: after a fresh load `caches.keys()` should include the Workbox precache plus the `"model-cache"` and `"ort-runtime"` routes, and a subsequent offline hard reload should cold-load the app and run live inference with no network requests.

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
- **`src/lib/camera`**: constraint building (rear camera requested) and every `DOMException` name mapped to its `CameraErrorCode`, plus the `UNSUPPORTED` path when `mediaDevices` is missing, via `vi.stubGlobal("navigator", …)`.
- **`src/lib/wakeLock`**: acquire/release call the Wake Lock API correctly, re-acquires on a stubbed `visibilitychange` event, stops re-requesting after release, and is a safe no-op when the API is unsupported.
- **`src/workers/detection`**: `isWorkerResponse` accepts every valid message variant and rejects malformed ones (unknown backend, missing fields, unknown error code); the pure `preprocess` (ImageNet normalization, NCHW layout) and `decodeDetections` (sigmoid thresholding, cxcywh-to-xyxy, class-index-1 selection) helpers in `inference.ts` are tested directly against known inputs.
- **`src/context/DetectionContext`**: the full status machine against an injected fake worker (the `createWorker` test seam), including the one-frame-in-flight invariant across a fast `stop()`-then-`start()` (a regression test for a real race that was fixed), retrying after a `createImageBitmap` failure, and the FPS calculation staying finite.
- **`src/context/SettingsContext`**: defaults `showVideo` to true, toggling flips and persists it to `localStorage`, a fresh mount restores the persisted value, and corrupt or wrong-shaped stored JSON falls back to defaults.
- **Components** (RTL): `CameraView` attaches the stream and reports a typed error on failure (stubbing `getUserMedia`); `HudOverlay` renders the nearest box with/without the NEAR pill and positions floating tags, using exact pixel assertions against known inputs; `RadarStrip` positions one blip per detection by fraction and styles the near blip amber; `StatusBar` renders the wordmark and the settings gear and shows no FPS readout; `ModelLoadScreen` stays hidden during the anti-flash delay and then shows byte/percent progress; `ErrorScreen` covers every error code with non-empty copy; `SettingsButton` opens the panel; `SettingsScreen` renders nothing until opened, toggles and persists the video setting, shows the live engine readout (or a starting placeholder), and closes on the close button or Escape; `RadarBackdrop` renders a non-interactive full-bleed grid; `CameraView` keeps the video mounted but `opacity-0` when `visible` is false; `App` shows the camera-unavailable error screen end-to-end with a stubbed `Worker` and `navigator`.

Real camera video, real onnxruntime-web inference (both backends), and real layout/visual rendering are verified manually: chrome-devtools MCP against a built preview (`pnpm build && pnpm start`) for the model-load screen, backend detection, offline cold-load, and Cache Storage contents; genuine on-device phone testing (sustained FPS against real traffic, both orientations, thermal/battery behavior) is the user's job post-merge, since neither jsdom nor a desktop headless browser has a real dash-mounted camera.

---

## 10. Non-Functional Requirements

- **Offline-first**: fully functional with no network after the first successful model download (see §7). Service worker updates apply silently (`autoUpdate`, no UI prompt).
- **No secrets, no logging of sensitive data** (`CLAUDE.md`): v1 has no secrets and no user data to log in the first place; the camera stream and every detection stay in the tab.
- **`pnpm check` clean** (format, lint, typecheck) before commits.
- **Bundle size**: no date-picker, form, or crypto libraries carried over from the starter; the largest code dependency is `onnxruntime-web` itself, an accepted cost for on-device inference (the model weights are downloaded from Hugging Face at runtime, not bundled). The unused ~26 MB bundled ONNX `.wasm` build artifact (§7) is known dead weight, not part of the runtime path, and deliberately excluded from the service-worker precache.

## 11. Success Criteria (Acceptance)

1. Opening the app on a phone requests the rear camera and shows the live feed full-screen.
2. On a WebGPU-capable device, the nearest road-relevant object gets an amber box and label once its box is large enough to count as NEAR; other road-relevant objects get floating tags; the radar strip shows a blip per detection.
3. On a device without WebGPU, the same behavior runs on the WASM fallback, more slowly, with the status bar reading `CPU` instead of `GPU`.
4. Camera permission denial, no camera, camera-in-use, and an unsupported browser each show their own explanatory `ErrorScreen`, never a blank page or an uncaught exception.
5. A model load failure or an inference crash shows an error screen with a working reload action, not a blank page.
6. The screen does not sleep while detection is running, and re-locks/re-acquires correctly around tab visibility changes.
7. After the first successful load, the app cold-loads and runs live detection fully offline.
8. All tests pass and `pnpm check` is clean.
