---
name: verifying-in-browser
description: Use when work touches the detection worker, inference, the camera, the service worker, model caching, or offline behavior and needs verifying for real. Covers what jsdom cannot run, how to test first-visit caching against a production build, what to check on a physical device, and the headless-Chrome screenshot recipe for PWA icons.
---

# Verifying in a browser

## What jsdom can't run

`pnpm test` can't touch the worker, inference, or the camera. Tests inject a fake worker through `DetectionProvider`'s `createWorker` seam and stub `createImageBitmap`/`getUserMedia`; the pure `preprocess`/`decodeDetections` helpers are unit-tested directly.

So green tests say nothing about whether detection works. Anything in that path gets verified in Chrome via chrome-devtools, and on a physical device when timing or heat is part of the claim.

## Desktop Chrome

Drive it with the chrome-devtools MCP tools. What to look for:

- Console clean of WGSL, GridSample, and ORT session errors. A bad shader shows up here and nowhere else.
- The graph-capture path taken, not the plain-session fallback.
- Detection scores against a reference image, when the model or the decode changed.

Cross-origin isolation has to hold for the runtime to load, so a blocked cross-origin request in the network panel is a real failure, not noise.

## First-visit model caching

`DetectionContext` defers the worker's `load` until `navigator.serviceWorker.controller` is set, so the model fetch goes through the service worker and lands in the `"model-cache"` route. This is production only, bounded by `SW_CONTROL_TIMEOUT_MS`; dev has no service worker at all, and `cacheModelInDev` covers dev instead.

That means it cannot be verified with `pnpm dev`. Build and serve for real:

```bash
pnpm build && pnpm start
```

Then load with storage cleared (DevTools > Application > Clear site data, or a fresh incognito window) and confirm the model request is served by the service worker and shows up in the cache. Reload offline and confirm it comes back without a network hit.

## On a real device

The phone is the only place two things are true: thermals and round-trip time. A change that runs inference more often or more heavily gets measured on a dash-mounted device in the sun before it ships, not reasoned about. Round-trip numbers from a desktop GPU do not transfer, and WebKit and Chromium Android behave differently enough that a win on one is not a win on the other.

## Regenerating PWA icons

Headless Chrome screenshots at small window sizes come back cropped. Render at 512x512 and downscale with `sips -z <h> <w>`.
