# CLAUDE.md - DashRadar App

## Project Overview

**DashRadar** is a Next.js web application that provides real-time object detection using a webcam feed. The app uses TensorFlow.js with the COCO-SSD model to identify objects in the camera view and provides audio feedback through the browser's speech synthesis API.

**Status**: Early prototype / Proof of concept - code needs cleanup

**Key Features**:
- Real-time object detection via webcam
- TensorFlow.js COCO-SSD model integration
- Speech announcements for detected objects
- Visual overlay with emoji representations
- Dark mode support

## Tech Stack

- **Framework**: Next.js 12.3.1 (Pages Router)
- **Runtime**: React 18.2.0 (`reactStrictMode: true`)
- **Language**: TypeScript 4.8.4 (`strict: true`)
- **ML/AI**:
  - @tensorflow/tfjs ^4.0.0 (webgl backend)
  - @tensorflow-models/coco-ssd ^2.2.2 (`lite_mobilenet_v2` base)
- **Streams**: RxJS ^7.8.0
- **Utilities**: lodash (`once`, `throttle`, `debounce`), memoizee
- **PWA**: next-pwa ^5.6.0
- **Analytics**: fathom-client ^3.5.0

There is **no UI library in use**. `@nextui-org/react` and `usehooks-ts` are listed
in `package.json` but never imported. All UI is plain JSX styled by
`styles/globals.css`. Text-to-speech is the native `SpeechSynthesisUtterance`
API, not a library.

## Project Structure

```
.
├── components/          # React components
│   └── Loading/        # Loading bar (plain JSX + CSS)
├── lib/                # Core utilities
│   ├── tf.ts          # Model loading, detection loop, object ID tracking
│   ├── webcam.ts      # Webcam stream + typed error handling
│   ├── speak.ts       # Speech synthesis + vibration
│   └── utils.ts       # Color, dark mode, observable hook, reload helpers
├── observables/        # DEAD CODE - see note below
├── pages/
│   ├── index.tsx      # The entire app (video, canvas, detection, error UI)
│   ├── _app.tsx       # Head tags, PWA manifest, Fathom analytics
│   └── api/ping.ts    # Health check
├── public/             # Static assets (sw.js and workbox* are build output)
└── styles/globals.css  # All styling
```

`observables/index.ts` exports a stale duplicate of `getDetectedObjects$` that
nothing imports. The live implementation is `lib/tf.ts`. Do not edit
`observables/`, and do not treat it as a reference.

## Development

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
npm start        # production server on port 3001
npm run lint     # next lint
npx tsc --noEmit # typecheck (no dedicated npm script)
```

There is no test suite and no test runner configured. Verification is manual, in
a real browser with a real camera. No environment variables are required; nothing
in the app reads `process.env`.

## Deployment

Deployed to Vercel as project `dashradar` (see `.vercel/project.json`).

## Key Implementation Details

### Object Detection Flow

1. **Webcam Stream**: `addWebcamStreamToVideoEl` requests camera access
   (`facingMode: "environment"`, 1280x720 ideal) and attaches the stream to the
   `<video>` element.
2. **Detection Loop**: `getDetectedObjects$` in `lib/tf.ts` runs
   `model.detect(videoEl)` and reschedules itself via
   `videoEl.requestVideoFrameCallback`, not `setInterval` or
   `requestAnimationFrame`. Browsers lacking that API detect exactly once and
   then stop.
3. **Filtering**: results are filtered against `allowList` in `lib/tf.ts` before
   anything downstream sees them.
4. **ID Tracking**: an RxJS `pairwise()` pipe compares each frame to the previous
   one. When bounding boxes of the same class overlap past
   `OVERLAP_THRESHOLD_ID` (0.6) the previous frame's `id` is carried forward, so
   an object keeps a stable color across frames. Past
   `OVERLAP_THRESHOLD_BBOX` (0.9) the previous box is reused to reduce jitter.
5. **Canvas Overlay**: `renderDetections` in `pages/index.tsx` draws boxes,
   labels, and emoji. Detections scoring below `UNKNOWN_THRESHOLD` (0.7) render
   as a faint unlabeled box.
6. **Audio Feedback**: `speakItem` announces the class, heavily rate limited.

`getDetectedObjects$` returns `{ observable, cleanup }`, not a bare observable.
The caller must invoke `cleanup()` on unmount or the frame loop keeps running.

### Notable Files

- `pages/index.tsx`: the whole app. Tagged
  `@todo NEEDS REFACTOR into smaller separate components / custom hooks`.
- `lib/tf.ts`: `allowList`, thresholds, model loading, detection loop, ID tracking
- `lib/webcam.ts`: stream setup and `WebcamError` classification
- `lib/speak.ts`: speech throttling, `speakingBlocklist`
- `lib/utils.ts`: hash-based color generator, dark mode, reload helpers

## Gotchas

- **Adding a detectable class takes two edits.** `allowList` in `lib/tf.ts`
  filters detections before the UI sees them. Adding a class to `emojiMap` in
  `pages/index.tsx` alone does nothing. The reverse also holds: several
  allow-listed classes (car, truck, bus, bird, horse, laptop, bottle) have no
  emoji and render blank on purpose.
- **Camera retry does not work without a reload.** `getMediaStream` is wrapped in
  lodash `once`, so the "Try Again" button re-awaits the same cached promise. If
  the first request was rejected, every retry resolves to the same rejection.
  `reloadWindowDelayed` in `lib/utils.ts` exists to work around this.
- **A service worker runs in development.** next-pwa is configured without a
  `disable` option, so `npm run dev` registers `/sw.js` too. Expect stale assets
  and unregister the worker or hard-reload when changes do not appear.
- **Silence is usually correct.** Speech passes three gates: `speak` is throttled
  to one utterance per 10s globally, `speakItem` is memoized per class for 90s,
  and `speakingBlocklist` mutes `car`, `truck`, and `traffic light`, the three
  most common driving detections.
- **The overlay never clears.** The pipeline filters out empty frames
  (`filter(length > 0)`), so when everything leaves view the last boxes stay
  drawn. `pairwise()` also means the very first detection frame is dropped.
- **`pages/index.tsx` speaks at module scope.** `speakThrottled("Loading please
  wait...")` runs on import, including during SSR and `next build`. The
  `speaking not supported` line in build output is expected.
- **The error UI is unstyled.** `.error-message`, `.retry-button`, and
  `.error-help` are used in `pages/index.tsx` but defined nowhere in
  `globals.css`. Only `#error` is styled.
- **Colors are randomized per page load.** `getColor` hashes the object id plus a
  module-level `Math.random()` seed, so the same object gets a different color on
  each reload.

## Common Tasks

1. **Adding a detected object type**: add to `allowList` in `lib/tf.ts`, then to
   `emojiMap` in `pages/index.tsx`.
2. **Adjusting detection sensitivity**: `UNKNOWN_THRESHOLD` in `lib/tf.ts`
   controls the label/emoji cutoff. `OVERLAP_THRESHOLD_ID` and
   `OVERLAP_THRESHOLD_BBOX` control cross-frame identity and box smoothing.
3. **Changing speech behavior**: throttle window and blocklist in `lib/speak.ts`.
4. **Model configuration**: `DEFAULT_TENSORFLOW_BACKEND` and
   `DEFAULT_TENSORFLOW_BASE` in `lib/tf.ts`.
5. **UI changes**: edit the JSX in `pages/index.tsx` and the CSS in
   `styles/globals.css`. There is no component library to consult.

## Testing Considerations

- Requires camera access, so it needs `localhost` or HTTPS. Testing on a phone
  over the LAN needs a tunnel or a TLS cert.
- Best tested in a real browser, not headless.
- Performance is CPU/GPU bound and varies widely by device.
- Speech synthesis availability varies by browser and OS.

## Git Repository

Origin: `git@github.com:tuxracer/dashradar-app.git`

Older references point to `https://git.fedi.ai/derek/dashradar-app` and its
issue tracker at `https://git.fedi.ai/tuxracer/dashradar-app/issues`.

## Additional Notes

- PWA with offline support via next-pwa. `public/sw.js`, `public/sw.js.map`, and
  `public/workbox-*.js` are generated by `npm run build` and are gitignored.
- Fathom analytics is hardcoded in `pages/_app.tsx` and only reports for the
  `dashradar.app` domain.
- The package name is still `car-radar`.
- Production runs on port 3001 to avoid conflicts.
