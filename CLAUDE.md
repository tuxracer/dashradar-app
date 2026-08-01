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
- **The QR code complements a share action; it is never a fallback for one.** Wherever the app hands itself to another device, show `ShareQr` unconditionally and add the Web Share button on top where `canShareApp()` is true. Never gate the QR on the share sheet being missing. The two solve different problems: the QR moves the app to a *second screen* someone is holding (and needs nothing from the browser), while the share sheet moves it to a *second device* of your own, which is the only thing that helps when the failing device is the phone in your hand. Treating either as the other's last resort removes a route that was doing its own job. Same rule for any future handoff surface, not just `ErrorScreen` and `IntroScreen`.

**Thermal and battery budget is a first-class constraint.** Continuous neural inference on a phone clamped to a windshield in direct sun is close to the worst thermal environment a phone sees, and a detector that throttles or kills the phone mid-drive fails silently exactly when the driver relies on it. The current balance is the 1 s scan floor (`MIN_FRAME_INTERVAL_MS`) plus the adaptive rest ratio, with the coasting tracker and peak-hold meter covering the gaps between results. Gate any change that runs inference more often or more heavily on "does this heat the phone or drain the battery on a real dash-mounted device in the sun", verified on-device, and bias toward the conservative side.

**The budget covers always-on UI work, not just inference.** Sessions run for hours and idle scanning is the dominant state, so "cheap" per-frame work compounds: a rAF loop or timer that runs for the whole session must park itself once its output is a fixed point and be woken by change (see the `RadarDetectorScreen` meter loop), and per-tick DOM writes must be skipped while the values behind them are unchanged. Don't add unconditionally scheduled per-frame loops, polling timers, or always-on CSS animations without weighing their idle-state cost; CSS animations run on the compositor but still keep the display refreshing.

### Rejected ideas (do not re-propose)

Ideas evaluated in feature brainstorms and rejected. Don't bring these up again:

- **Detecting red/blue flashing emergency lights** (strobe/flicker detection, "active lights" alerts, reflected-strobe or cloud-bounce detection, or anything similar). A vehicle running its emergency lights is already the most visually obvious thing on the road; the driver needs no help noticing it, so the feature adds cost without value.
- **Windshield-reflection HUD mode** (mirroring the display so it reflects off the windshield). The phone is also the camera: laying it face-up on the dash to project the UI points the camera at the ceiling, so the detector stops working the moment the mode is used.

## Architecture

Client-only **Vite 8 React SPA** with no server runtime (the build is a static `dist/`). Data flow: `src/App.tsx` → `DetectionProvider` (consumed via `useDetection()`) → `src/workers/detection` (RF-DETR ONNX on raw onnxruntime-web in a Web Worker, WebGPU only) → `src/lib/detection` road-class filter → `src/lib/detectionTracker` coasting smoother → `src/lib/detection` HUD shaping (all pure, no React). `DetectionContext` owns the worker lifecycle and frame pump; components only ever read `useDetection()`.

Module map (internals in TRD §4 and §5):

- `src/context/DetectionContext/`: worker lifecycle and frame-pump state machine; pacing, periodic worker recycle, camera-stall detection and recovery, crash-sentinel heartbeat, auto zoom stepping, contact/saved-frame state, ref-backed debug snapshot.
- `src/context/SettingsContext/`: localStorage-backed settings (`settings`) behind the `developerOptions` master switch. The provider hands out already-gated effective values, so consumers never repeat the gate. Every developer option starts at its `DEVELOPER_OPTIONS_OFF` value, so turning the master switch on reveals rows without turning anything on; a `settingsVersion` migration clears the five that used to default on.
- `src/context/DevVideoContext/`: owns the video-file source that stands in for the camera. Every session starts on the camera; a dropped or settings-picked file replaces it until cleared. Consume via `useDevVideo()`.
- `src/workers/detection/`: downloads the ONNX weights, runs inference; pure preprocess/decode in `inference.ts`, constants in `consts.ts`, typed message protocol in `types.ts`.
- `src/lib/`: React-free domain modules, one directory each: `detection`, `detectionTracker`, `autoZoom`, `radarSignal`, `radarAudio`, `camera`, `crashSentinel`, `browserEngine`, `videoFileDrop`, `pwaInstall`, `saveFrame`, `serviceWorker`, `timingHistory`, `wakeLock`, and friends.
- `src/components/`: `CameraView` (hidden `<video>`, the feed is never shown), `RadarDetectorScreen` (the only detection UI; rAF peak-hold loop writing straight to the DOM, drives the beeper and contact card), `StatusBar` + indicator pills, `SettingsScreen`, `DebugOverlay`, `SaveToast`, `ShareTarget` (the handoff cluster: SCAN TO OPEN annunciator, QR in lock-on brackets, Web Share button; shared by the desktop intro and `UnsupportedScreen` so the app's two handoffs cannot drift apart), `UnsupportedScreen` (the WEBGPU_UNSUPPORTED handoff, framed as an invitation rather than an error), intro/permission/load/error screens.
- `src/types/`: shared detection types and guards.

**Frame pump**: only one frame is ever in flight (latest wins, no queue). Captures are at least `MIN_FRAME_INTERVAL_MS` (1000 ms) apart, and every capture additionally rests `PACING_REST_RATIO` (1) of the last round trip, so a slow device's interval is twice its round trip. The dev-only `throttleInference` off state drops the delay to 0; turning Developer options off always restores the floor. The pump pauses when the page goes hidden and while settings are open, each pauser resuming only sessions it paused. Workers are recycled every `WORKER_RECYCLE_AFTER_MS` (15 min) at a result boundary to bound native memory growth; one-time analytics events are ref-gated so recycles never re-fire them.

**Rendering**: pure client-side SPA. Never introduce SSR/SSG.

**Bundling**: ship all application code in the initial load; no lazy loading, dynamic `import()`, or code splitting (runtime chunk fetches break offline use). The one sanctioned exception is the detection worker chunk, which the Workbox precache includes.

**Telemetry**: Vercel Analytics and Sentry are both gated on Do Not Track / Global Privacy Control via the [`privacy-signals`](https://github.com/tuxracer/privacy-signals) package (extracted from this repo; only `isTrackingOptedOut() === false` enables them, since `null` means the signals were unreadable and is not consent), and dev builds emit nothing.

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

**Important**: Always run `pnpm check` before commits. It only verifies formatting; run `pnpm format` to fix.

**Documentation**: When making major changes (architecture, new modules, API changes), update [docs/TRD.md](docs/TRD.md).

## Git Workflow

- **Always rebase when integrating to `main`, never create merge commits** (`git rebase`, `git merge --ff-only`). Keep history linear.
- **Already on `main` and asked to commit? Commit straight to `main`.** Don't create a branch first. Branching only to fast-forward `main` right back is a pointless round trip: the commit lands in the same place, just after two extra steps and a deleted branch. Branch only when there's a real reason (asked for, work already on one, or genuine isolation for a long or risky change); a big diff is not a reason on its own.

## Tech Stack

- **Vite 8** (Rolldown) + **React 19** + **TypeScript** (ESM); **vite-plugin-pwa** (Workbox precache, installable PWA)
- **Tailwind CSS v4** on bespoke HUD elements; no shadcn/Radix primitives; `lucide-react` is the only starter dep still in use
- **onnxruntime-web** in a Web Worker; hand-rolled preprocess/decode (no Transformers.js)
- **remeda** (utilities and the type guards that validate worker messages), **@vercel/analytics**, **@sentry/react** (release-stamped with `APP_RELEASE`)
- Build-time stamps `__APP_VERSION__`/`__COMMIT_SHA__` from `vite.config.ts`, shown in the settings About row
- **Rajdhani** via `@fontsource/rajdhani` (500/600/700), the only font
- Tests: **vitest** + **@testing-library/react** (jsdom; see Gotchas for what it can't run)

## Model

A custom **RF-DETR Small** checkpoint fine-tuned on Las Vegas Metro police vehicles, published at [`tuxracer/las-vegas-metro-rfdetr-small-t1`](https://huggingface.co/tuxracer/las-vegas-metro-rfdetr-small-t1) and trained/exported from the sibling repo `~/Development/las-vegas-metro-rfdetr-small-t1`. Mobile WebGPU is the only target and the only execution path. `MODEL_URL` (`src/workers/detection/consts.ts`) streams `model_fp16.onnx` (~57 MB, mixed precision). Signature: input `[1,3,512,512]` fp32 NCHW; outputs `dets [1,300,4]` (cxcywh, normalized) and `labels [1,300,2]` (raw logits, per-query sigmoid, police at index 1). No NMS. See Gotchas before changing the model.

## Gotchas

- **WebGPU is the only execution path; don't reintroduce a CPU (wasm) fallback.** The int8 build that used to serve it measured >10 s round trips on an Android phone where WebGPU takes ~500 ms. Scanning the road once every ten seconds misses most of what the car drives past, so shipping it as a silent fallback made the app look functional while being useless, which is worse for the project than not running. A device that fails `probeWebGpu()` gets the terminal `WEBGPU_UNSUPPORTED` screen instead (after the intro, before the camera ask, and before any model bytes are fetched).
- **Raw onnxruntime-web on purpose, never the Transformers.js `pipeline()`.** The head is a 2-wide sigmoid with the real class at index 1; the pipeline's softmax-with-background DETR decode drops every real detection, and `RfDetrImageProcessor` isn't a registered JS processor. Any replacement model must be verified end-to-end on WebGPU in a real browser; there is no second execution path to catch a bad export.
- **Keep GridSample fp32 in any future export.** The WebGPU fp16 build is mixed precision with its three GridSample nodes kept fp32 (pure-fp16 GridSample generated invalid WGSL under JSEP). If an export changes GridSample precision or the WebGPU URL moves to a different build, re-verify before shipping: zero GridSample/WGSL errors and a reference-image score match. The fp16 tensors require the `shader-f16` GPU feature, which `probeWebGpu()` gates on (along with actually acquiring an adapter and device) so unsupported devices are turned away before any download.
- **The worker imports `onnxruntime-web/webgpu` (native C++ WebGPU EP), and that import is load-bearing.** Graph capture (`WEBGPU_GRAPH_CAPTURE`, on) requires it: the root import's JSEP kernel registry has no TopK, so this graph's TopK node lands on CPU and capture fails deterministically. `ORT_RUNTIME_FILES` in `vite.config.ts` must track the import (asyncify files for `/webgpu`). Keep the fallback to a plain WebGPU session. **Capture is excluded on WebKit** (`isWebKitUa`): iOS Safari 26 killed the page within seconds with capture on (Sentry DASHRADAR-2); lift only after a real iPhone survives a long scanning session. Pre-switch JSEP op behavior does not transfer to the native EP; re-check before relying on it.
- **Frame-pump invariants in `DetectionContext` are hard-won race fixes**: one frame in flight (`inFlightRef`), a generation counter (`pumpGenerationRef`) invalidating captures from before a `stop()`, and no side effects inside `setState` updaters (StrictMode double-invokes them; branch on `statusRef` instead, as `start()` and the `ready` handler do).
- **jsdom can't run the worker, inference, or the camera.** Tests inject a fake worker through `DetectionProvider`'s `createWorker` seam and stub `createImageBitmap`/`getUserMedia`; real verification happens in Chrome (chrome-devtools) and on-device. The pure `preprocess`/`decodeDetections` helpers are unit-tested directly.
- **Model caching pins a revision.** The `"model-cache"` Workbox route is `CacheFirst` keyed on URL, so the model URL pins `MODEL_REVISION`, never `main`. To ship a new model: push a new HF tag, verify `MODEL_URL` returns 200 (`curl -sIL -o /dev/null -w '%{http_code}' <url>`), then bump `MODEL_REVISION`. The ORT runtime is served same-origin from `/ort/` by the `ortRuntime` Vite plugin and cached by the `"ort-runtime"` route; both routes are excluded from the precache glob.
- **First-visit model caching requires waiting for service-worker control.** `DetectionContext` defers the worker's `load` until `navigator.serviceWorker.controller` is set (production only; `waitForServiceWorkerControl`, bounded by `SW_CONTROL_TIMEOUT_MS`). Don't move the model fetch back to fire unconditionally on mount. Verify with a real production build and cleared caches; dev has no service worker (`cacheModelInDev` covers dev instead).
- **Cross-origin isolation (COOP `same-origin` + COEP `require-corp`) is load-bearing.** Headers come from `vercel.json` (prod) and Vite config (dev); they enable `SharedArrayBuffer` and multi-threaded WASM. Inference runs on the GPU, but onnxruntime-web's runtime is itself a wasm module hosting the WebGPU EP and running any node it can't take, so the threading still matters. Don't add a cross-origin `<script>`/`<link>`/no-cors fetch without CORS/CORP or it will be blocked.
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
- **Branch on source values, not derived ones**: read the condition off the value that decides it, not off an intermediate boolean someone set earlier.
- **Type guards over `as` assertions** on runtime-unknown values: use remeda guards or write one. Union-type guards validate the actual allowed values and use the named type in the return annotation (`value is DetectionErrorCode`), not a hardcoded union.
- **Typed errors over string messages**: custom error classes with a typed `code` plus an `isXError` guard (see `CameraError` in `src/lib/camera/types.ts`).
- **Tests verify behavior, not implementation**: never assert a constant's value; test the behavior the constant affects.
- **Test logic that can break, not values that were typed in.** A test that asserts a function returns a specific UI string is a change-detector: it can only fail when someone intentionally edits the copy, and then the "fix" is to paste the new string into the test. It proves nothing and adds friction to every copy change.
- **Hold a high bar for what earns a unit test.** Coverage for its own sake is not a goal; a test per line of code is noise that slows every future change. Write tests for the things that can break without anyone meaning to: state machines and race-prone lifecycles (the frame pump, worker recycling, stall recovery), math and decode logic, filtering and threshold rules, parsers and type guards, and edge cases around empty, missing, or out-of-range input. Skip tests whose only assertion is that a component rendered the string it was handed, that a prop reached a child, or that a constant still equals itself.
