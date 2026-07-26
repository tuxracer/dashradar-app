# dashradar

A single-screen web app that turns a dash-mounted phone into a live, on-device police-vehicle detector, presented as a full-screen radar-detector-style signal meter. Real-time object detection runs on the rear camera feed, which is never shown on screen; only the meter and, during a detection, a small evidence card are visible. Client-only **Vite React SPA**, **offline-first PWA**, **no backend, no accounts, no data leaves the device**.

**This is a computer-vision detector, NOT a radar detector.** It cannot detect radar, LIDAR, or any RF emission; "radar" is only a visual metaphor for the UI. In user-facing copy (README, marketing, in-app strings), never call the app a "radar detector" or say it detects radar. The correct framing: an on-device, computer-vision police detector that spots patrol vehicles on the road in real time.

[docs/TRD.md](docs/TRD.md) is the full technical reference (architecture internals, worker protocol, settings, detection domain, offline strategy, error handling). This file holds the conventions and the gotchas that must not regress.

**Repository URL**: https://github.com/tuxracer/dashradar-app

## Design & Use Case

Primary use case: **landscape, on a dash mount**. The driver interacts by reaching across the cabin at arm's length and glancing briefly. Rules that follow:

- **Beautiful minimalism.** Show only what earns its place; high contrast, no clutter.
- **Large touch targets.** Every control must be hittable on the first try, one-handed, without looking closely. When in doubt, make it bigger.
- **Glanceable, low-effort interaction.** Few taps, obvious state, no fine motor precision.
- **Landscape-first layout.** Portrait must not look broken. The one exception is the first-open intro (`IntroScreen`/`IntroScene`), composed portrait-first because a first-time user meets it holding the phone in the hand.

**Thermal and battery budget is a first-class constraint.** Continuous neural inference on a phone clamped to a windshield in direct sun is close to the worst thermal environment a phone sees, and a detector that throttles or kills the phone mid-drive fails silently exactly when the driver relies on it. The current balance is the 2 s scan floor (`MIN_FRAME_INTERVAL_MS`) plus the adaptive rest ratio, with the coasting tracker and peak-hold meter covering the gaps between results. Gate any change that runs inference more often or more heavily on "does this heat the phone or drain the battery on a real dash-mounted device in the sun", verified on-device, and bias toward the conservative side.

## Architecture

Client-only **Vite 8 React SPA** with no server runtime (the build is a static `dist/`). Data flow: `src/App.tsx` → `DetectionProvider` (consumed via `useDetection()`) → `src/workers/detection` (RF-DETR ONNX on raw onnxruntime-web in a Web Worker, WebGPU or WASM) → `src/lib/detection` road-class filter → `src/lib/detectionTracker` coasting smoother → `src/lib/detection` HUD shaping (all pure, no React). `DetectionContext` owns the worker lifecycle and frame pump; components only ever read `useDetection()`.

Module map (internals in TRD §4 and §5):

- `src/context/DetectionContext/`: worker lifecycle and frame-pump state machine; pacing, periodic worker recycle, camera-stall detection and recovery, crash-sentinel heartbeat, auto zoom stepping, contact/saved-frame state, ref-backed debug snapshot.
- `src/context/SettingsContext/`: localStorage-backed settings (`dashradar:settings`) behind the `developerOptions` master switch. The provider hands out already-gated effective values, so consumers never repeat the gate. `autoSaveFrames` is the one developer option that defaults off even under the switch.
- `src/workers/detection/`: downloads the ONNX weights, runs inference; pure preprocess/decode in `inference.ts`, constants in `consts.ts`, typed message protocol in `types.ts`.
- `src/lib/`: React-free domain modules, one directory each: `detection`, `detectionTracker`, `autoZoom`, `radarSignal`, `radarAudio`, `camera`, `crashSentinel`, `backendSafeMode`, `browserEngine`, `devVideo`, `doNotTrack`, `pwaInstall`, `saveFrame`, `serviceWorker`, `timingHistory`, `wakeLock`, and friends.
- `src/components/`: `CameraView` (hidden `<video>`, the feed is never shown), `RadarDetectorScreen` (the only detection UI; rAF peak-hold loop writing straight to the DOM, drives the beeper and contact card), `StatusBar` + indicator pills, `SettingsScreen`, `DebugOverlay`, `SaveToast`, intro/permission/load/error screens.
- `src/types/`: shared detection types and guards.

**Frame pump**: only one frame is ever in flight (latest wins, no queue). Captures are at least `MIN_FRAME_INTERVAL_MS` (2000 ms) apart, and slow devices additionally rest `PACING_REST_RATIO` (0.5) of the last round trip. The dev-only `throttleInference` off state drops the delay to 0; turning Developer options off always restores the floor. The pump pauses when the page goes hidden and while settings are open, each pauser resuming only sessions it paused. Workers are recycled every `WORKER_RECYCLE_AFTER_MS` (15 min) at a result boundary to bound native memory growth; one-time analytics events are ref-gated so recycles never re-fire them.

**Rendering**: pure client-side SPA. Never introduce SSR/SSG.

**Bundling**: ship all application code in the initial load; no lazy loading, dynamic `import()`, or code splitting (runtime chunk fetches break offline use). The one sanctioned exception is the detection worker chunk, which the Workbox precache includes.

**Telemetry**: Vercel Analytics and Sentry are both gated on Do Not Track / Global Privacy Control (`src/lib/doNotTrack`), and dev builds emit nothing.

## Commands

```bash
pnpm dev         # Vite dev server, http://localhost:5173
DASHRADAR_VIDEO=<path> pnpm dev   # Dev-video mode: a local clip substitutes for the camera (see src/lib/devVideo)
pnpm build       # Production build (vite build → dist/)
pnpm start       # Serve the production build (vite preview)
pnpm test        # Run tests once (vitest run)
pnpm test:watch  # Run tests in watch mode
pnpm check       # Verify formatting + lint + typecheck (run before commits)
pnpm format      # Auto-fix formatting (prettier --write)
```

**Important**: Always run `pnpm check` before commits. It only verifies formatting; run `pnpm format` to fix.

**Documentation**: When making major changes (architecture, new modules, API changes), update [docs/TRD.md](docs/TRD.md).

## Git Workflow

- **Always rebase when integrating to `main`, never create merge commits** (`git rebase`, `git merge --ff-only`). Keep history linear.

## Tech Stack

- **Vite 8** (Rolldown) + **React 19** + **TypeScript** (ESM); **vite-plugin-pwa** (Workbox precache, installable PWA)
- **Tailwind CSS v4** on bespoke HUD elements; no shadcn/Radix primitives; `lucide-react` is the only starter dep still in use
- **onnxruntime-web** in a Web Worker; hand-rolled preprocess/decode (no Transformers.js)
- **remeda** (utilities and the type guards that validate worker messages), **@vercel/analytics**, **@sentry/react** (release-stamped with `APP_RELEASE`)
- Build-time stamps `__APP_VERSION__`/`__COMMIT_SHA__` from `vite.config.ts`, shown in the settings About row
- **Rajdhani** via `@fontsource/rajdhani` (500/600/700), the only font
- Tests: **vitest** + **@testing-library/react** (jsdom; see Gotchas for what it can't run)

## Model

A custom **RF-DETR Small** checkpoint fine-tuned on Las Vegas Metro police vehicles, published at [`tuxracer/las-vegas-metro-rfdetr-small-t1`](https://huggingface.co/tuxracer/las-vegas-metro-rfdetr-small-t1) and trained/exported from the sibling repo `~/Development/las-vegas-metro-rfdetr-small-t1`. Mobile WebGPU is the primary target; evaluate model and runtime changes there first, with WASM as the fallback path. `MODEL_URL_BY_BACKEND` (`src/workers/detection/consts.ts`) streams `model_fp16.onnx` (~57 MB, mixed precision) on WebGPU and `model_int8.onnx` (~31 MB) on WASM. Shared signature: input `[1,3,512,512]` fp32 NCHW; outputs `dets [1,300,4]` (cxcywh, normalized) and `labels [1,300,2]` (raw logits, per-query sigmoid, police at index 1). No NMS. See Gotchas before changing the model.

## Gotchas

- **Raw onnxruntime-web on purpose, never the Transformers.js `pipeline()`.** The head is a 2-wide sigmoid with the real class at index 1; the pipeline's softmax-with-background DETR decode drops every real detection, and `RfDetrImageProcessor` isn't a registered JS processor. Any replacement model must be verified end-to-end on WebGPU in a real browser, not just on the WASM fallback.
- **Keep GridSample fp32 in any future export.** The WebGPU fp16 build is mixed precision with its three GridSample nodes kept fp32 (pure-fp16 GridSample generated invalid WGSL under JSEP). If an export changes GridSample precision or the WebGPU URL moves to a different build, re-verify before shipping: zero GridSample/WGSL errors and a reference-image score match. The fp16 tensors require the `shader-f16` GPU feature, which `resolveBackend()` gates on (along with actually acquiring an adapter and device) so unsupported devices go straight to WASM without double-downloading.
- **The worker imports `onnxruntime-web/webgpu` (native C++ WebGPU EP), and that import is load-bearing.** Graph capture (`WEBGPU_GRAPH_CAPTURE`, on) requires it: the root import's JSEP kernel registry has no TopK, so this graph's TopK node lands on CPU and capture fails deterministically. `ORT_RUNTIME_FILES` in `vite.config.ts` must track the import (asyncify files for `/webgpu`). Keep the fallback to a plain WebGPU session. **Capture is excluded on WebKit** (`isWebKitUa`): iOS Safari 26 killed the page within seconds with capture on (Sentry DASHRADAR-2); lift only after a real iPhone survives a long scanning session. Pre-switch JSEP op behavior does not transfer to the native EP; re-check before relying on it.
- **Frame-pump invariants in `DetectionContext` are hard-won race fixes**: one frame in flight (`inFlightRef`), a generation counter (`pumpGenerationRef`) invalidating captures from before a `stop()`, and no side effects inside `setState` updaters (StrictMode double-invokes them; branch on `statusRef` instead, as `start()` and the `ready` handler do).
- **jsdom can't run the worker, inference, or the camera.** Tests inject a fake worker through `DetectionProvider`'s `createWorker` seam and stub `createImageBitmap`/`getUserMedia`; real verification happens in Chrome (chrome-devtools) and on-device. The pure `preprocess`/`decodeDetections` helpers are unit-tested directly.
- **Model caching pins a revision.** The `"model-cache"` Workbox route is `CacheFirst` keyed on URL, so the model URLs pin `MODEL_REVISION`, never `main`. To ship a new model: push a new HF tag, verify both URLs return 200 (`curl -sIL -o /dev/null -w '%{http_code}' <url>`), then bump `MODEL_REVISION`. The ORT runtime is served same-origin from `/ort/` by the `ortRuntime` Vite plugin and cached by the `"ort-runtime"` route; both routes are excluded from the precache glob.
- **First-visit model caching requires waiting for service-worker control.** `DetectionContext` defers the worker's `load` until `navigator.serviceWorker.controller` is set (production only; `waitForServiceWorkerControl`, bounded by `SW_CONTROL_TIMEOUT_MS`). Don't move the model fetch back to fire unconditionally on mount. Verify with a real production build and cleared caches; dev has no service worker (`cacheModelInDev` covers dev instead).
- **Cross-origin isolation (COOP `same-origin` + COEP `require-corp`) is load-bearing for WASM threading.** Headers come from `vercel.json` (prod) and Vite config (dev); they enable `SharedArrayBuffer` and multi-threaded WASM (several-fold latency difference on non-WebGPU phones). Don't add a cross-origin `<script>`/`<link>`/no-cors fetch without CORS/CORP or it will be blocked.
- **Never upscale frames fed to the model.** Every crop drawn onto the 512x512 input must come from at least 512x512 native camera pixels. This is why `CAMERA_CONSTRAINTS` requests ~1024 per axis (the 2x crop lands at 512 native) and why zoom stops at 2x. Gate any new zoom level or capture-size change on the granted stream's actual dimensions (`min(videoWidth, videoHeight) >= zoom * INPUT_SIZE`), never fall back to upscaling.
- **`mapBoxToViewport` assumes `object-fit: cover`** on the video element. Currently unused (retained from the earlier bounding-box HUD), but if the video CSS changes and a consumer draws boxes again, the math must change with it.
- **Worker module import exception**: never import `src/workers/detection/index.ts` (it pulls onnxruntime-web into the importer). Consumers import protocol types and guards from `@/workers/detection/types` directly. This is a deliberate exception to the import-from-module-index rule.
- **Regenerating PWA icons**: headless Chrome screenshots at small window sizes come back cropped. Render at 512x512 and downscale with `sips -z <h> <w>`.

## Coding Standards

- **Never log sensitive data** (API keys, tokens, passwords); use `[REDACTED]` if a value's existence matters.
- **No a11y lint**: jsx-a11y is intentionally absent; don't add ARIA markup purely for convention or flag missing aria tags in reviews.
- **No em dashes or AI-isms in docs**: plain, direct voice; no "delve", "seamless", "robust", "leverage", adjective triads, emoji headings, or "In summary" wrap-ups.
- **Package manager**: `pnpm` for everything.
- **ESM imports only**: `import`, never `require()`.
- **Arrow functions**: `const foo = () => { ... }` (ESLint-enforced).
- **Reserve the `use` prefix for React hooks**: boolean options are `systemFont`/`enableCache`, not `useSystemFont`.
- **Named imports**: `import { pipe, filter } from "remeda"`, never `import * as R` (tree-shaking).
- **Import paths**: cross-module imports use the `@/` alias; relative paths only within a module. Import from the module, not internal files (`@/lib/detection`, not `@/lib/detection/consts`), with `src/workers/detection` as the one exception above.
- **Module structure**: modules are directories named after their primary export, containing `index.ts` plus optional `consts.ts` (every exported constant lives here, never in `index.ts`), `types.ts` (types and guards), and `tests.ts` (`.tsx` when tests render JSX). `index.ts` re-exports types and consts. No barrel-only files.
- **React context over prop drilling** for app-wide state (see `DetectionContext`).
- **Remeda utilities** over manual loops where readability wins.
- **Named constants**, no magic numbers; underscore separators for numbers 1000 and up (`1_500`).
- **Local dates, not UTC**: never `toISOString()` for a date-only value; use local getters.
- **DRY**: extract a helper once a pattern appears 3+ times; shared utilities go in `src/utils/` (create it on first need, module-directory convention).
- **JSDoc**: skip `@param`/`@returns`; types cover them.
- **Loading indicators**: delay ~1 second to avoid flash.
- **Settings row descriptions**: exactly one short sentence that fits on one mobile line; no clause chaining, never spell out on/off states or write "when on"/"when off".
- **Intl API** over manual date/number formatting.
- **Branch on source values, not derived ones**: `backend === "webgpu" ? "fp16" : "q8"`, not an intermediate `isWasm` flag.
- **Type guards over `as` assertions** on runtime-unknown values: use remeda guards or write one. Union-type guards validate the actual allowed values and use the named type in the return annotation (`value is DetectionBackend`), not a hardcoded union.
- **Typed errors over string messages**: custom error classes with a typed `code` plus an `isXError` guard (see `CameraError` in `src/lib/camera/types.ts`).
- **Tests verify behavior, not implementation**: never assert a constant's value; test the behavior the constant affects.
