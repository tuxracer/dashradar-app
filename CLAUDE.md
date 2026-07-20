# dashradar

A single-screen web app that turns a phone mounted on a car dash into a live object-detection HUD (a "radar view"). A full-screen rear-camera feed runs through an on-device object detector, drawn as a clean, automotive-minimal overlay: one full bounding box on the nearest object, floating tag markers on the rest, and a lane-radar strip showing where things are at a glance. Client-only **Vite React SPA**, **offline-first PWA**, **no backend, no accounts, no data leaves the device**.

See [docs/TRD.md](docs/TRD.md) for the full technical reference.

**Repository URL**: https://github.com/tuxracer/dashradar-app

## Design & Use Case

**Primary use case: landscape, on a dash mount.** The app is meant to run on a phone mounted on a car dash, in a fixed cradle, facing out the windshield, held in **landscape** orientation. The driver is the user, but they are seated well away from the phone: they interact with it by reaching across the cabin at arm's length, glancing at it briefly, and getting their eyes back on the road. Design every screen and control for that reach-over-at-a-distance interaction, not for a phone held comfortably in the hand. Portrait may happen and shouldn't look broken, but landscape is what we design and tune for.

**Design principles that follow from this:**

- **Beautiful minimalism.** Show only what earns its place on the glass. The HUD should read at a glance with almost no visual parsing: automotive-minimal, high contrast, no clutter or decorative chrome competing with the camera feed and detections.
- **Large touch targets.** Every interactive control (the settings gear, toggles, retry actions, any future buttons) must be big and well-spaced enough to hit reliably on the first try from the driver's seat, one-handed, without looking closely. Prefer generously oversized hit areas over compact, dense layouts. When in doubt, make controls bigger.
- **Glanceable, low-effort interaction.** Interactions should be quick and forgiving: few taps, obvious state, nothing that demands sustained attention or fine motor precision. Assume the user's attention is on driving and their hand is stretched across the cabin.
- **Landscape-first layout.** Lay out and tune for landscape first. Keep controls reachable within a landscape frame and don't push essential touch targets to hard-to-reach corners.

## Architecture

Client-only **Vite 8 React SPA** with **no backend or server runtime of its own** (the build is a static `dist/`). Data flows `src/App.tsx` → `DetectionProvider` (consumed via `useDetection()`) → `src/workers/detection` (a Web Worker running the RF-DETR ONNX model through raw onnxruntime-web, WebGPU or WASM) → `src/lib/detection`'s road-class filter → `src/lib/detectionTracker`'s temporal persistence gate → `src/lib/detection`'s HUD shaping (all pure, no React). `DetectionContext` owns the worker lifecycle and the frame pump; components only ever read `useDetection()`'s state.

- **`index.html` + `src/main.tsx`**: Vite entry, mounts `<App />` under `StrictMode`, imports the `@fontsource/rajdhani` weights and `src/globals.css`, injects Vercel Analytics, and registers the PWA service worker (`virtual:pwa-register`, `autoUpdate`).
- **`src/App.tsx`**: composes the single screen. `DetectionProvider` wraps a `RadarScreen` that renders `CameraView`, `HudOverlay`, `RadarStrip`, and `StatusBar`, swapping in `ModelLoadScreen` or `ErrorScreen` based on `useDetection()`'s status.
- **`src/context/DetectionContext/`**: worker lifecycle and frame-pump state machine; consume with the `useDetection()` hook (status `loading-model → ready → running → error`, backend, model load progress, `downloadingModel`, the latest `HudModel`, fps, a per-frame `debug` snapshot, `start`/`stop`). In production the worker's `load` message is deferred until the service worker controls the page (see Gotchas) so the first-visit model download is cached. `downloadingModel` is true only while the weights stream over the network: the worker probes `caches.match` before fetching and reports `model-load-start` with `fromCache`, so a cache load (which still spends a beat compiling the ONNX session) doesn't flash the `ModelLoadScreen` "DOWNLOADING MODEL" panel that `App` gates on `downloadingModel`. The `debug` snapshot (`DebugSnapshot`) combines the worker's per-frame `timing` with context-side capture and round-trip timing plus raw/filtered/confirmed detection counts (before `toRoadDetections`, after it, and after the `detectionTracker` persistence gate), updated on every result regardless of whether the debug overlay is shown. It also owns the motion-sensor lifecycle: `sendFrame` snapshots `src/lib/motionSensor`'s current yaw/pitch (a copy, not a live reference) into a capture-pose ref at the instant each frame is captured, and the `detections` handler promotes that snapshot to the reference pose once the frame's result comes back. `getMotionDelta()` reads the live orientation against that reference pose; `motionPermission` and `requestMotionPermission()` expose the motion-sensor's iOS permission state for `StartGate`.
- **`src/context/SettingsContext/`**: localStorage-backed display options (`showVideo`, `showDebug`, `stabilizeMotion`) plus the ephemeral full-screen-settings open state (`settingsOpen`/`openSettings`/`closeSettings`, not persisted), consumed via the `useSettings()` hook (`toggleShowVideo`/`toggleShowDebug`/`toggleStabilizeMotion`). `stabilizeMotion` gates gyro motion compensation and defaults off. Persisted options are stored under `dashradar:settings` and validated on read: `isPersistedSettings` accepts a partial shape so a stored blob from before `showDebug` existed still validates, and `loadSettings` merges it over `DEFAULT_SETTINGS`. Wraps the app outside `DetectionProvider`.
- **`src/workers/detection/`**: the Web Worker body. Downloads the RF-DETR ONNX weights, creates an onnxruntime-web `InferenceSession`, and runs inference per frame. `inference.ts` holds the pure `preprocess` (RGBA frame → `[1,3,512,512]` NCHW ImageNet-normalized float32) and `decodeDetections` (raw `dets`/`labels` outputs → normalized `RawDetection[]`); `consts.ts` holds the model URLs, input size, and normalization constants. Its `types.ts` defines the typed message protocol (`WorkerRequest`/`WorkerResponse` plus type guards); see Gotchas for why consumers import from `types.ts` directly instead of the module's `index.ts`. The `detections` response also carries `timing: { preprocessMs, inferenceMs, decodeMs }` for the debug overlay.
- **`src/lib/camera/`**: React-free `getUserMedia` handling, rear-camera constraints, permission/device errors mapped to a typed `CameraError`.
- **`src/lib/detection/`**: React-free domain logic, the road-class filter and confidence threshold (`toRoadDetections`), nearest-object/`NEAR` shaping for the HUD (`buildHudModel`), and normalized-box-to-viewport coordinate mapping (`mapBoxToViewport`).
- **`src/lib/detectionTracker/`**: React-free stateful persistence gate sitting between `toRoadDetections` and `buildHudModel` in `DetectionContext`. The pure `stepTracker(state, detections, nowMs, config)` greedily matches a frame's detections to existing tracks by IoU (`iou`, `IOU_MATCH_THRESHOLD`); a pending track must be matched every frame or it's dropped (suppressing single-frame blips), confirms once matched while at least `PERSIST_MS` old, and a confirmed track coasts up to `MAX_MISSES` unmatched frames before dropping (preventing flicker). `createDetectionTracker()` wraps it in a stateful `.update(detections, nowMs)` for the context to call once per frame; `initialTrackerState()` gives the empty starting state.
- **`src/lib/wakeLock/`**: Screen Wake Lock acquire/release, re-acquiring on `visibilitychange`.
- **`src/lib/serviceWorker/`**: React-free service-worker helpers: `waitForServiceWorkerControl` (used by `DetectionContext` to defer the model download until the service worker controls the page, so a first visit caches instead of racing ahead of Workbox) and `requestPersistentStorage` (best-effort `navigator.storage.persist()`).
- **`src/lib/motionSensor/`**: React-free `devicemotion` `rotationRate` integration into a running yaw/pitch orientation, using real elapsed time and remapping device-frame axes to the screen frame via `screen.orientation.angle`. Handles iOS `DeviceMotionEvent.requestPermission()` and persists a `dashradar:motionGranted` localStorage flag so a prior grant isn't re-prompted. `createMotionSensorManager()` exposes `start`/`stop`/`getYawPitch`/`getPermission`/`requestPermission`; pure helpers `mapRotationRateToScreen`, `integrateYawPitch`, and `orientationDeltaToPixels` plus the `ASSUMED_CAMERA_HFOV_DEG` tuning constant are also exported for direct testing and reuse. Graceful no-op when `devicemotion` is unsupported or permission is denied: the orientation simply stays at zero, so consumers see no compensation rather than an error.
- **`src/components/`**: `CameraView` (the `<video>`), `RadarBackdrop` (static radar-grid background layer), `HudOverlay` (nearest-object box + floating tag markers; takes a `debug` prop that annotates each with its confidence and normalized box coords; a `requestAnimationFrame` loop reads `getMotionDelta()` and writes a `transform: translate(dx,dy)` on the overlay container, off the React render path, so a stale box tracks its object between detection results, but only when the `stabilize` prop (the `stabilizeMotion` setting) is on, otherwise the transform is held at zero), `RadarStrip` (lane-radar blips), `StatusBar` (wordmark + settings gear), `SettingsButton` (enlarged gear that opens the full-screen settings panel), `SettingsScreen` (full-screen settings panel: Video feed, Debug overlay, and Motion stabilization toggles plus read-only Detection engine, Model, and About rows), `DebugOverlay` (top-left diagnostics panel showing timing, detection counts, and system info, plus a `motion` row (delta yaw/pitch in degrees) and an `offset` row (dx/dy in pixels) for tuning motion compensation; rendered only when the `showDebug` setting is on), `ModelLoadScreen` (download progress), `ErrorScreen` (camera/detection error copy with a retry action), `StartGate` (full-screen iOS tap-to-start gate shown only after the user enables `stabilizeMotion` and while motion permission is still promptable, per `shouldShowStartGate`, and only when the settings panel is closed; the tap supplies the user gesture iOS requires to call `DeviceMotionEvent.requestPermission()`; never shown on Android/desktop or once a prior grant is on record).
- **`src/types/`**: shared detection types + guards (`RawDetection`, `NormalizedBox`, `Detection`, `isRawDetection`, …).

Each module is a directory named after its primary export, containing `index.ts` and optionally `consts.ts` (constants), `types.ts` (types + guards), and `tests.ts`.

**Frame-pump backpressure**: only one frame is ever in flight to the worker. The next frame is sent only after the previous result comes back (latest-wins, no queue), so detection self-paces to whatever the device can do without ever blocking the video. See Gotchas for the invariants that keep this true under React StrictMode.

**Rendering**: pure client-side SPA. There is no server rendering of any kind. Never introduce SSR/SSG or anything that renders app state outside the browser.

**Bundling**: ship all application code in the initial load. Do not lazy-load scripts, use dynamic `import()`, or set up route/feature code-splitting. Runtime chunk fetches break offline use, and offline support is a goal for this client-only app. The one sanctioned exception is the detection Web Worker (`src/workers/detection/index.ts`), loaded via `new Worker(new URL(...), { type: "module" })`: Vite necessarily builds it as its own chunk, but the Workbox precache manifest (`vite-plugin-pwa`) includes it alongside the rest of the build, so it comes from the same offline-capable cache rather than a live network fetch. Optimize bundle size by other means (drop unused deps, prefer smaller libraries) rather than deferring loads.

**Model**: a custom **RF-DETR Small** checkpoint fine-tuned to detect Las Vegas Metro police vehicles, published as ONNX at [`tuxracer/las-vegas-metro-rfdetr-small-t1`](https://huggingface.co/tuxracer/las-vegas-metro-rfdetr-small-t1) and trained/exported from the sibling repo `~/Development/las-vegas-metro-rfdetr-small-t1` (see its `CLAUDE.md` for the export recipes). `MODEL_URL_BY_BACKEND` in `src/workers/detection/consts.ts` streams `onnx/model.onnx` (~118 MB, full-precision fp32) on WebGPU and `onnx/model_int8.onnx` (~35 MB, int8 dynamic quant) on WASM, both directly from Hugging Face at runtime. WebGPU intentionally uses fp32, not the smaller fp16 build, because onnxruntime-web's WebGPU GridSample kernel emits invalid WGSL for fp16 (see Gotchas). `resolveBackend()` picks WebGPU only when it can actually acquire a GPU adapter and device (it awaits `requestAdapter()`/`requestDevice()`), not merely when `navigator.gpu` exists, so a device that exposes the API but can't create a device downloads only the int8 build instead of downloading the fp32 build, failing, and downloading int8 too (see Gotchas). Both builds share one signature: input `[1,3,512,512]` fp32 NCHW, outputs `dets [1,300,4]` (cxcywh boxes normalized 0..1) and `labels [1,300,2]` (raw class logits). We run it through **raw onnxruntime-web, not the Transformers.js pipeline**, because the model's head is a single real class scored with a per-query **sigmoid** (index 1 = police, index 0 unused), which the pipeline's softmax-with-background DETR decoder reads wrong and drops. `inference.ts` does the matching preprocess and sigmoid + cxcywh decode by hand. No NMS (RF-DETR is set-based). See Gotchas before changing the model.

## Commands

```bash
pnpm dev         # Vite dev server, http://localhost:5173
pnpm build       # Production build (vite build → dist/)
pnpm start       # Serve the production build (vite preview)
pnpm test        # Run tests once (vitest run)
pnpm test:watch  # Run tests in watch mode
pnpm check       # Verify formatting + lint + typecheck (run before commits)
pnpm format      # Auto-fix formatting (prettier --write)
```

**Important**: Always run `pnpm run check` before commits to ensure code is properly formatted, linted, and type-safe. Do not run formatting, linting, or typechecking separately. `check` only *verifies* formatting (`prettier --check`); if it flags formatting issues, run `pnpm format` to auto-fix.

**Documentation**: When making major changes (architecture, new modules, API changes, file structure), update [docs/TRD.md](docs/TRD.md) to keep the technical reference accurate.

## Git Workflow

- **Always rebase when integrating to `main`, never create merge commits**: Bring a branch up to date with `git rebase main`, and land it with a fast-forward (`git merge --ff-only` or `git rebase`). Never run `git merge` in a way that produces a merge commit on `main`; keep history linear.

## Tech Stack

- **Vite 8** (Rolldown) + **React 19** + **TypeScript** (ESM) · **vite-plugin-pwa** (Workbox service worker precaches the build for offline cold-loads; installable PWA manifest + icons in `public/`)
- **Tailwind CSS v4**, styling a handful of bespoke HUD elements. There are no shadcn/Radix `src/components/ui/` primitives: the starter's `radix-ui`, `class-variance-authority`, `tailwind-merge`, and `tw-animate-css` were pruned. `lucide-react` is the one starter dep still in use (the `Settings` and `X` icons in `SettingsButton`/`SettingsScreen`)
- **`onnxruntime-web`**: runs the RF-DETR ONNX model entirely on-device, inside a Web Worker; WebGPU when available, WASM fallback. Preprocessing, decode, and thresholding are done by hand in `src/workers/detection/inference.ts` (no Transformers.js pipeline)
- **remeda** (array/object utilities, and type guards like `isString`/`isNumber`/`isPlainObject` that validate worker messages crossing the `postMessage` boundary)
- **`@vercel/analytics`** (page-view analytics; `inject()` in `src/main.tsx`)
- **Build-time version stamps**: `vite.config.ts` `define`s `__APP_VERSION__` (from `package.json`) and `__COMMIT_SHA__` (short git SHA, or `VERCEL_GIT_COMMIT_SHA` on Vercel; `"unknown"` when neither resolves), declared in `src/vite-env.d.ts` and shown in `SettingsScreen`'s About row. It also injects a `<meta name="version">` tag into `index.html`. These are compile-time constants, not runtime env reads
- **Rajdhani** self-hosted via `@fontsource/rajdhani` (weights 500/600/700): the only font. The Autopilot HUD direction doesn't use a second display or mono face
- Tests: **vitest** + **@testing-library/react**. jsdom can't run the worker, onnxruntime-web inference, or the camera, so those are stubbed/injected in tests (see Gotchas). The pure `preprocess`/`decodeDetections` helpers in `src/workers/detection/inference.ts` are unit-tested directly (`src/workers/detection/tests.ts`)

## Gotchas

- **The RF-DETR model is run via raw onnxruntime-web on purpose, not the Transformers.js `pipeline()`.** Transformers.js loads `rf_detr` but decodes it with the RT-DETR post-processor (softmax + "last class index is background, skip it"). This checkpoint's head is a 2-wide **sigmoid** with the real police class at index 1 (the last index), so the pipeline drops every real detection, and `RfDetrImageProcessor` isn't a registered JS processor type. No `preprocessor_config.json` edit fixes it. That is why the worker bypasses `pipeline()` with a direct `InferenceSession` and hand-rolled preprocess/decode. Earlier the app used the generic-COCO `onnx-community/rtdetr_v2_r18vd-ONNX` through the pipeline (and before that D-FINE, `onnx-community/dfine_n_coco-ONNX`, whose decode graph fails `OrtRun()` on the WebGPU EP and only works on WASM). If you evaluate a different model, verify it end-to-end on WebGPU in a real browser, not just against the WASM fallback.
- **WebGPU runs the fp32 model, not fp16, because onnxruntime-web's WebGPU GridSample kernel is broken for fp16.** RF-DETR's decoder uses `GridSample` (3 nodes here). With fp16 weights, onnxruntime-web generates invalid WGSL for it (`Error while parsing WGSL: no matching overload for 'operator * (f32, f16)'`), so the shader fails to compile, the `GridSample` compute pipeline is invalid, and the op silently produces garbage. Detections on every WebGPU device come out broken (the WASM/no-WebGPU path is unaffected and stays correct). The fix is to serve full-precision `onnx/model.onnx` on WebGPU (`MODEL_URL_BY_BACKEND`), which makes the multiply `f32 * f32`. Verified in Chrome via chrome-devtools MCP: the GridSample WGSL error flood drops to zero and inference produces detections. Do not switch WebGPU back to `model_fp16.onnx` without confirming onnxruntime-web has fixed the fp16 GridSample shader (was still broken as of onnxruntime-web 1.27). fp32 also needs no `shader-f16` GPU feature, so it runs on GPUs the fp16 build could not even create a session on.
- **Frame-pump invariants in `src/context/DetectionContext` are hard-won race fixes**; don't undo them:
  - Only one frame is ever in flight (`inFlightRef` counter), and a generation counter (`pumpGenerationRef`) invalidates an in-flight `createImageBitmap()` capture left over from before a `stop()`/`start()`, so it can't stack a second frame onto the restarted pump.
  - No side effects inside `setState` updater functions. React double-invokes updaters under `StrictMode`, which would double-pump frames if a frame send lived inside one. `statusRef` mirrors `status` exactly so event handlers can branch on the current status outside of a `setState` call; every `setStatus` call site updates `statusRef` alongside it. Don't add a `sendFrame()` call inside a `setStatus(prev => ...)` updater; branch on `statusRef` instead, the way `start()` and the `"ready"` message handler already do.
- **jsdom can't run the worker, onnxruntime-web inference, or the camera**: those are verified in a real browser (chrome-devtools) and on-device. Unit tests inject a fake worker through `DetectionProvider`'s `createWorker` test seam and stub `createImageBitmap` / `navigator.mediaDevices.getUserMedia` with `vi.stubGlobal` (see `src/context/DetectionContext/tests.tsx`, `src/lib/camera/tests.ts`). The pure `preprocess`/`decodeDetections` helpers do run under jsdom and are tested directly.
- **Two Workbox runtime-cache routes make the app work offline; clearing either forces a re-download.** Both are `CacheFirst` routes in `vite.config.ts`. The `"model-cache"` route caches the RF-DETR ONNX weights the worker `fetch()`es from `huggingface.co` at runtime (the worker streams them itself to report byte progress, so they are not in the precache glob). The worker also reads this route directly via `caches.match(url)` before fetching, to tell a cache hit from a network download (`model-load-start`'s `fromCache`); the match succeeds despite the cached response's `Vary: origin, ...` header because both the worker's GET and the probe omit those headers. The `"ort-runtime"` route caches the onnxruntime-web `.wasm`/`.mjs` runtime, which is served **same-origin** from `/ort/` by the `ortRuntime` Vite plugin (`vite.config.ts`) rather than from a CDN. The worker sets `env.wasm.wasmPaths` to `/ort/` so the runtime and its thread workers load from our origin; the plugin copies the two files onnxruntime-web's bundle build actually fetches (`ort-wasm-simd-threaded.jsep.wasm` + `.mjs`) out of `node_modules` (never committed) and prunes the hashed duplicate Vite would otherwise emit into `dist/assets`. Both routes' files are excluded from the precache glob (no `wasm`/`mjs` extensions) so a ~27 MB runtime isn't front-loaded into the service-worker install.
- **The app is served cross-origin isolated (COOP `same-origin` + COEP `require-corp`), and that is load-bearing for WASM performance.** The headers come from `vercel.json` in production and Vite `server`/`preview` config in dev. They make `SharedArrayBuffer` available so onnxruntime-web can run multi-threaded WASM (`env.wasm.numThreads`, capped by `WASM_THREAD_CAP` in `src/workers/detection/consts.ts`); without them ORT silently falls back to one thread, which on the many mobile devices with no usable WebGPU is the difference between ~1 and several inference threads (a several-fold latency gap). `require-corp` was chosen over `credentialless` because it works on every browser including Safari. It is only viable because nothing the page loads needs a cross-origin exemption: the ONNX runtime is same-origin (`/ort/`), the Hugging Face model `fetch()` is a CORS request (which passes `require-corp`), and Vercel Analytics is served same-origin (`/_vercel/...`). Don't add a cross-origin `<script>`/`<link>`/`fetch(..., {mode:'no-cors'})` without giving it CORS/CORP, or it will be blocked. The backend probe reports `crossOriginIsolated` and the configured thread count in the debug overlay.
- **The model is only cached if the worker's fetch is intercepted by the service worker, which it isn't on a first visit unless we wait.** The model is `fetch()`ed from inside the detection Web Worker. On a genuine first visit the worker is created and starts fetching before the service worker takes control of the page (the `clientsClaim` race), so that fetch bypasses the `"model-cache"` route and nothing is stored until a later visit. `DetectionContext` defers the worker's `load` message until `navigator.serviceWorker.controller` is set (`waitForServiceWorkerControl`, bounded by `SW_CONTROL_TIMEOUT_MS`), and only in production (`import.meta.env.PROD`; dev has no service worker, so it loads immediately). Don't move the model fetch back to fire unconditionally on mount, or first-visit caching breaks again. Verifying this needs a real production build (`pnpm build && pnpm start`) with a cleared service worker + Cache Storage: in `pnpm dev` there is no service worker at all, so the model always re-downloads. The `huggingface.co` `resolve` URL 302-redirects to a signed, per-request CDN URL, but Workbox keys the cache on the stable request URL so later visits still hit; `src/main.tsx` also calls `requestPersistentStorage()` to reduce cache eviction on mobile.
- **Coordinate mapping assumes `object-fit: cover`**: `mapBoxToViewport` (`src/lib/detection`) does scale-to-cover math with a center-crop offset, matching `CameraView`'s `<video>` element. If the video's CSS ever changes (to `contain`, or a fixed aspect box), `mapBoxToViewport` must change with it or boxes will drift off their objects.
- **Worker module import exception**: `src/workers/detection/index.ts` is the worker's own body. Importing it, even just for types, pulls `onnxruntime-web` into whatever imports it. Consumers (`DetectionContext`, components) import the message-protocol types and guards from `@/workers/detection/types` directly, not from the worker module's `index.ts`. This is a deliberate, intentional exception to the "import from the module index" rule below.
- **Regenerating PWA icons**: headless Chrome screenshots at a small `--window-size` (e.g. 192x192) come back cropped/misaligned even though the reported pixel dimensions look right. Render at 512x512 (reliable) and downscale with `sips -z <h> <w>` for the smaller sizes instead of asking headless Chrome to screenshot a small window directly.
- **`devicemotion` axes are in the device's portrait frame and have to be remapped for landscape.** `mapRotationRateToScreen` (`src/lib/motionSensor`) swaps and flips `rotationRate`'s `alpha`/`beta`/`gamma` based on `screen.orientation.angle` before integrating them into yaw/pitch. The axis signs there, and the `ASSUMED_CAMERA_HFOV_DEG` constant used to convert the resulting delta to pixels, were tuned on-device against the debug overlay's `motion`/`offset` rows, not derived analytically; re-verify both if the pan direction ever looks wrong. iOS motion permission needs a user gesture (`DeviceMotionEvent.requestPermission()`) and there's no API to query whether it was already granted, so a `dashradar:motionGranted` localStorage flag suppresses the `StartGate` on return visits; the sensor integration itself still attaches on mount regardless of permission state, it just receives no events until permission is granted. Compensation is rotation-only (yaw/pitch), not translation, and boxes are never dropped early: the overlay container is `overflow-hidden`, so a pan large enough to move a box off-screen just slides it past the edge instead of the code hiding it early.

## Coding Standards

- **Never log sensitive data**: Do not log API keys, tokens, passwords, or other secrets. Use placeholder text like `[REDACTED]` if you need to indicate a value exists without revealing it
- **No accessibility (a11y) lint**: jsx-a11y is intentionally absent from the ESLint setup, and there is no need to add ARIA attributes, roles, or other markup purely for accessibility conventions. We expect AI-based accessibility tools to handle this app without them. Don't re-introduce jsx-a11y rules or flag missing aria tags in reviews
- **No em dashes or AI-isms in docs**: Write documentation in a plain, direct voice. Don't use em dashes; restructure the sentence or use commas, colons, or parentheses instead. Avoid telltale LLM phrasing: "delve", "seamless", "robust", "leverage", "elevate", "It's not just X, it's Y", adjective triads ("fast, simple, and powerful"), emoji headings, and "In summary" wrap-ups. Prefer concrete, specific statements
- **Package manager**: Use `pnpm` for all package management (install, add, remove, etc.)
- **ESM imports only**: Always use `import` syntax, never `require()`. This is an ESM project and `require` will throw `ReferenceError: require is not defined`
- **Arrow functions**: Use `const foo = () => { ... }` (enforced by ESLint, auto-fixable)
- **Reserve `use` prefix for React hooks**: The `useFoo` naming convention is reserved for React hooks. For boolean options or flags, use names like `systemFont`, `enableCache`, or `withValidation` instead of `useSystemFont`, `useCache`, or `useValidation`
- **Named imports**: Use `import { pipe, filter } from 'remeda'` not `import * as R` (tree-shaking)
- **Import paths use the `@/` alias**: Import across modules with the `@/` alias (`@/lib/detection`, `@/lib/camera`), which maps to `src/` (see `tsconfig.json`). Reserve relative paths for files within the same module (`./types`, `./consts`); don't reach across modules with `../`.
- **React context over prop drilling**: For app-wide state that's needed across many components (e.g., the detection status, backend, and latest HUD model), use React context instead of passing props through multiple levels. See `src/context/DetectionContext` for an example, consumed via the `useDetection()` hook. This keeps component interfaces clean and avoids threading props through intermediate components that don't use them.
- **Remeda utilities**: Prefer for array/object manipulation over manual loops where it improves readability without hurting performance (e.g., `flatMap` to flatten nested loops, `find` for searching, `sortBy` for sorting)
- **Named constants**: Use `const HEADER_SIZE = 16` not magic numbers
- **Numeric separators**: Use underscore separators for numbers 1000 and above for readability (`1_500`, `44_100`, `100_000`)
- **Local dates, not UTC**: when code needs a local date (e.g., "today"), derive it from local time, not UTC. Never `new Date().toISOString()` for a date-only value: it converts through UTC first, which can land on the wrong day in time zones behind UTC. Use local getters (`getFullYear()`/`getMonth()`/`getDate()`) or a date library's local-time formatter if one is added
- **DRY (Don't Repeat Yourself)**: When a pattern appears 3+ times, extract it into a helper function. Place shared utilities in `src/utils/` following the module-directory convention below (this app has none yet; add the directory the first time a helper needs to be shared). This improves readability and maintainability without impacting performance
- **Module structure**: Always create modules as directories with `index.ts`, never as single `moduleName.ts` files. Name the directory after the primary export (class, function, or concept). This provides a consistent location for related files:

  ```
  # GOOD - directory structure allows for growth
  src/lib/
    detection/
      index.ts       # exports toRoadDetections(), buildHudModel(), mapBoxToViewport(), …
      consts.ts      # CONFIDENCE_THRESHOLD, ROAD_CLASSES, NEAR_AREA_FRACTION
      tests.ts       # tests for the module
    camera/
      index.ts       # exports getCameraStream()
      consts.ts      # CAMERA_CONSTRAINTS
      types.ts       # CameraError, CameraErrorCode, isCameraError
      tests.ts

  # BAD - single files have nowhere for related code to go
  src/lib/
    detection.ts
    camera.ts
  ```

  Standard files within a module directory:

  - `index.ts` - Main module implementation, exports, and re-exports types/consts
  - `tests.ts` - Tests for the module (`tests.tsx` when the tests render JSX, as in components and contexts)
  - `consts.ts` - Module-specific constants
  - `types.ts` - Module-specific type definitions and their type guards (if needed)

- **Re-export types and consts from index.ts**: Each module's `index.ts` should re-export all types and consts from `types.ts` and `consts.ts`. External code should import from the module, not directly from internal files:

  ```typescript
  // GOOD - import from the module
  import { buildHudModel, NEAR_AREA_FRACTION } from "@/lib/detection";

  // BAD - importing directly from internal module files
  import { buildHudModel } from "@/lib/detection/index";
  import { NEAR_AREA_FRACTION } from "@/lib/detection/consts";
  ```

  In `detection/index.ts`:

  ```typescript
  export * from "./consts";
  ```

  The one deliberate exception is `src/workers/detection`: see "Worker module import exception" under Gotchas.

- **Avoid barrel-only files**: Don't create `index.ts` files that only re-export from child modules. Import directly from the specific module instead (e.g., `import { getCameraStream } from '@/lib/camera'` not `from '@/lib'`).
- **JSDoc**: Skip `@param`/`@returns` tags (TypeScript provides types); use inline comments if needed
- **Loading indicators**: Delay by ~1 second to avoid flash for fast operations
- **Intl API**: Prefer `Intl.DateTimeFormat`, `Intl.NumberFormat`, etc. over manual formatting for dates, numbers, and currencies
- **Explicit conditionals for derived values**: When a value like `dtype` is derived from another value like `backend`, branch on the source value, not the derived one. This makes the logic clearer and avoids confusion:

  ```typescript
  // GOOD - branch on the source value
  const dtype = backend === "webgpu" ? "fp16" : "q8";

  // BAD - mixes the source value with a value derived from it
  const isWasm = backend === "wasm";
  let dtype: DataType;
  if (backend === "webgpu") {
    dtype = "fp16";
  } else if (isWasm) {
    dtype = "q8"; // redundant, just use `backend`
  }
  ```

- **Type guards over type assertions**: Never use `as` type assertions on values with unknown runtime types. Use type guards from Remeda (`isString`, `isNumber`, `isBoolean`, `isPlainObject`) or create a new custom type guard if none exist:

  ```typescript
  // GOOD - type guard validates at runtime
  import { isString } from "remeda";

  if (isString(value)) {
    config.name = value;
  }

  // BAD - blind cast assumes type without validation
  config.name = value as string;
  ```

  For union types (e.g., `"webgpu" | "wasm"`), create a type guard that validates the actual values, not just the primitive type:

  ```typescript
  // GOOD - validates the value is one of the allowed options
  import { isString } from "remeda";
  import type { DetectionBackend } from "@/workers/detection/types";

  const DETECTION_BACKENDS: readonly DetectionBackend[] = ["webgpu", "wasm"];

  export const isDetectionBackend = (
    value: unknown,
  ): value is DetectionBackend => {
    return (
      isString(value) && DETECTION_BACKENDS.includes(value as DetectionBackend)
    );
  };

  // BAD - isString only checks primitive type, not valid union values
  if (isString(value)) {
    backend = value as DetectionBackend; // Still a blind cast!
  }
  ```

  When creating type guards for union types, use the named type in the return type annotation - don't hardcode the union:

  ```typescript
  // GOOD - uses the named type
  import type { DetectionBackend } from "@/workers/detection/types";

  export const isDetectionBackend = (
    value: unknown,
  ): value is DetectionBackend => {
    // ...
  };

  // BAD - hardcodes the union type (duplicates the type definition)
  export const isDetectionBackend = (
    value: unknown,
  ): value is "webgpu" | "wasm" => {
    // ...
  };
  ```

- **Typed errors over string messages**: When throwing errors, create a custom error class with a typed `code` property instead of using plain `Error` with string messages. This enables type-safe error handling:

  ```typescript
  // GOOD - typed error with machine-readable code
  export type CameraErrorCode =
    | "PERMISSION_DENIED"
    | "NO_CAMERA"
    | "CAMERA_IN_USE"
    | "UNSUPPORTED";

  export class CameraError extends Error {
    readonly code: CameraErrorCode;
    constructor(code: CameraErrorCode) {
      super(code);
      this.name = "CameraError";
      this.code = code;
    }
  }

  export const isCameraError = (error: unknown): error is CameraError => {
    return error instanceof CameraError;
  };

  // Usage - callers get autocomplete and type checking
  try {
    await getCameraStream();
  } catch (error) {
    if (isCameraError(error)) {
      switch (error.code) {
        case "PERMISSION_DENIED": // TypeScript knows valid codes
        // ...
      }
    }
  }

  // BAD - string messages aren't type-safe
  throw new Error("Permission denied");
  throw new Error("No camera found");
  ```

- **Tests verify behavior, not implementation**: Tests should verify that code works correctly, not enshrine implementation details. Never write tests that just check constant values - if a constant matters, test the behavior it affects:

  ```typescript
  // BAD - tests implementation detail, provides no value
  it("should have expected NEAR area fraction", () => {
    expect(NEAR_AREA_FRACTION).toBe(0.06);
  });

  // GOOD - tests actual behavior that depends on the constant
  it("flags NEAR only when the nearest box exceeds the area threshold", () => {
    const nearCar = detection({ box: box(0.3, 0.3, 0.7, 0.9) });
    expect(buildHudModel([nearCar]).near).toBe(true);

    const farCar = detection({ box: box(0.4, 0.4, 0.45, 0.45) });
    expect(buildHudModel([farCar]).near).toBe(false);
  });
  ```
