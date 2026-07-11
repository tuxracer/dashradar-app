# dashradar

A single-screen web app that turns a phone mounted on a car dash into a live object-detection HUD (a "radar view"). A full-screen rear-camera feed runs through an on-device object detector, drawn as a clean, automotive-minimal overlay: one full bounding box on the nearest object, floating tag markers on the rest, and a lane-radar strip showing where things are at a glance. Client-only **Vite React SPA**, **offline-first PWA**, **no backend, no accounts, no data leaves the device**.

See [docs/TRD.md](docs/TRD.md) for the full technical reference.

**Repository URL**: https://github.com/tuxracer/dashradar

## Architecture

Client-only **Vite 8 React SPA** with **no backend or server runtime of its own** (the build is a static `dist/`). Data flows `src/App.tsx` → `DetectionProvider` (consumed via `useDetection()`) → `src/workers/detection` (a Web Worker running the Transformers.js object-detection pipeline, WebGPU or WASM) → `src/lib/detection` (pure filtering and HUD shaping, no React). `DetectionContext` owns the worker lifecycle and the frame pump; components only ever read `useDetection()`'s state.

- **`index.html` + `src/main.tsx`**: Vite entry, mounts `<App />` under `StrictMode`, imports the `@fontsource/rajdhani` weights and `src/globals.css`, injects Vercel Analytics, and registers the PWA service worker (`virtual:pwa-register`, `autoUpdate`).
- **`src/App.tsx`**: composes the single screen. `DetectionProvider` wraps a `RadarScreen` that renders `CameraView`, `HudOverlay`, `RadarStrip`, and `StatusBar`, swapping in `ModelLoadScreen` or `ErrorScreen` based on `useDetection()`'s status.
- **`src/context/DetectionContext/`**: worker lifecycle and frame-pump state machine; consume with the `useDetection()` hook (status `loading-model → ready → running → error`, backend, model load progress, the latest `HudModel`, fps, `start`/`stop`).
- **`src/workers/detection/`**: the Web Worker body. Loads the Transformers.js `object-detection` pipeline and runs inference per frame. Its `types.ts` defines the typed message protocol (`WorkerRequest`/`WorkerResponse` plus type guards); see Gotchas for why consumers import from `types.ts` directly instead of the module's `index.ts`.
- **`src/lib/camera/`**: React-free `getUserMedia` handling, rear-camera constraints, permission/device errors mapped to a typed `CameraError`.
- **`src/lib/detection/`**: React-free domain logic, the road-class filter and confidence threshold (`toRoadDetections`), nearest-object/`NEAR` shaping for the HUD (`buildHudModel`), and normalized-box-to-viewport coordinate mapping (`mapBoxToViewport`).
- **`src/lib/wakeLock/`**: Screen Wake Lock acquire/release, re-acquiring on `visibilitychange`.
- **`src/components/`**: `CameraView` (the `<video>`), `HudOverlay` (nearest-object box + floating tag markers), `RadarStrip` (lane-radar blips), `StatusBar` (wordmark + backend/FPS readout), `ModelLoadScreen` (download progress), `ErrorScreen` (camera/detection error copy with a retry action).
- **`src/types/`**: shared detection types + guards (`RawDetection`, `NormalizedBox`, `Detection`, `isRawDetection`, …).

Each module is a directory named after its primary export, containing `index.ts` and optionally `consts.ts` (constants), `types.ts` (types + guards), and `tests.ts`.

**Frame-pump backpressure**: only one frame is ever in flight to the worker. The next frame is sent only after the previous result comes back (latest-wins, no queue), so detection self-paces to whatever the device can do without ever blocking the video. See Gotchas for the invariants that keep this true under React StrictMode.

**Rendering**: pure client-side SPA. There is no server rendering of any kind. Never introduce SSR/SSG or anything that renders app state outside the browser.

**Bundling**: ship all application code in the initial load. Do not lazy-load scripts, use dynamic `import()`, or set up route/feature code-splitting. Runtime chunk fetches break offline use, and offline support is a goal for this client-only app. The one sanctioned exception is the detection Web Worker (`src/workers/detection/index.ts`), loaded via `new Worker(new URL(...), { type: "module" })`: Vite necessarily builds it as its own chunk, but the Workbox precache manifest (`vite-plugin-pwa`) includes it alongside the rest of the build, so it comes from the same offline-capable cache rather than a live network fetch. Optimize bundle size by other means (drop unused deps, prefer smaller libraries) rather than deferring loads.

**Model**: `MODEL_ID` in `src/workers/detection/consts.ts` is `onnx-community/rtdetr_v2_r18vd-ONNX` (RT-DETRv2, r18vd backbone), loaded through the Transformers.js `object-detection` pipeline. `fp16` on WebGPU, `q8` (8-bit quantized) on WASM (`DTYPE_BY_BACKEND` in the same file). Boxes come back normalized to 0-1 fractions of the frame via `percentage: true`, so HUD math never depends on the input resolution. See Gotchas before changing `MODEL_ID`.

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
- **Tailwind CSS v4**. shadcn/Radix tooling (`radix-ui`, `class-variance-authority`, `tailwind-merge`, `lucide-react`, `tw-animate-css`) is kept from the starter but unused so far: v1's whole HUD is a handful of bespoke Tailwind-styled elements, and no `src/components/ui/` primitives exist yet
- **`@huggingface/transformers`** (Transformers.js): runs the object-detection pipeline entirely on-device, inside a Web Worker; WebGPU when available, quantized WASM fallback
- **remeda** (array/object utilities, and type guards like `isString`/`isNumber`/`isPlainObject` that validate worker messages crossing the `postMessage` boundary)
- **`@vercel/analytics`** (page-view analytics; `inject()` in `src/main.tsx`)
- **Rajdhani** self-hosted via `@fontsource/rajdhani` (weights 500/600/700): the only font. The Autopilot HUD direction doesn't use a second display or mono face
- Tests: **vitest** + **@testing-library/react**. jsdom can't run the worker, the Transformers.js pipeline, or the camera, so those are stubbed/injected in tests (see Gotchas)

## Gotchas

- **Do not swap `MODEL_ID` back to D-FINE** (`onnx-community/dfine_n_coco-ONNX`): its bounding-box decode graph fails `OrtRun()` on onnxruntime-web's WebGPU execution provider (a dynamic reshape/gather it can't run), on every frame, regardless of `dtype`. It only works on WASM. This was found during live device verification; RT-DETRv2 is the confirmed-working replacement on both backends. If you evaluate a different model, verify it end-to-end on WebGPU in a real browser, not just against the WASM fallback.
- **Frame-pump invariants in `src/context/DetectionContext` are hard-won race fixes**; don't undo them:
  - Only one frame is ever in flight (`inFlightRef` counter), and a generation counter (`pumpGenerationRef`) invalidates an in-flight `createImageBitmap()` capture left over from before a `stop()`/`start()`, so it can't stack a second frame onto the restarted pump.
  - No side effects inside `setState` updater functions. React double-invokes updaters under `StrictMode`, which would double-pump frames if a frame send lived inside one. `statusRef` mirrors `status` exactly so event handlers can branch on the current status outside of a `setState` call; every `setStatus` call site updates `statusRef` alongside it. Don't add a `sendFrame()` call inside a `setStatus(prev => ...)` updater; branch on `statusRef` instead, the way `start()` and the `"ready"` message handler already do.
- **jsdom can't run the worker, the Transformers.js pipeline, or the camera**: those are verified in a real browser (chrome-devtools) and on-device. Unit tests inject a fake worker through `DetectionProvider`'s `createWorker` test seam and stub `createImageBitmap` / `navigator.mediaDevices.getUserMedia` with `vi.stubGlobal` (see `src/context/DetectionContext/tests.tsx`, `src/lib/camera/tests.ts`).
- **Two independent caches make the app work offline; clearing either forces a re-download.** Transformers.js caches model weights in the browser Cache API under its own store. The `"ort-runtime"` Workbox route (`vite.config.ts`) `CacheFirst`-caches the onnxruntime-web `.wasm`/`.mjs` that gets fetched at runtime from `cdn.jsdelivr.net` (onnxruntime-web always fetches from jsdelivr unless `wasmPaths` is configured, which it isn't here, so the ~20MB `.wasm` Vite still emits into `dist/assets` is dead weight, deliberately excluded from the precache glob).
- **Coordinate mapping assumes `object-fit: cover`**: `mapBoxToViewport` (`src/lib/detection`) does scale-to-cover math with a center-crop offset, matching `CameraView`'s `<video>` element. If the video's CSS ever changes (to `contain`, or a fixed aspect box), `mapBoxToViewport` must change with it or boxes will drift off their objects.
- **Worker module import exception**: `src/workers/detection/index.ts` is the worker's own body. Importing it, even just for types, pulls `@huggingface/transformers` into whatever imports it. Consumers (`DetectionContext`, components) import the message-protocol types and guards from `@/workers/detection/types` directly, not from the worker module's `index.ts`. This is a deliberate, intentional exception to the "import from the module index" rule below.
- **Regenerating PWA icons**: headless Chrome screenshots at a small `--window-size` (e.g. 192x192) come back cropped/misaligned even though the reported pixel dimensions look right. Render at 512x512 (reliable) and downscale with `sips -z <h> <w>` for the smaller sizes instead of asking headless Chrome to screenshot a small window directly.

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
