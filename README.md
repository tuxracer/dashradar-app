# 🚔 dashradar.app

A privacy-first dashcam app that turns your phone into an on-device computer-vision police detector, spotting patrol vehicles on the road in real time.

Mount a phone on your car dash, and dashradar watches the road through the camera for one specific thing: police vehicles. It runs a custom object detector entirely on the phone. By default it shows a radar-detector-style instrument: a signal meter that climbs as a patrol vehicle comes into view, with an optional beep, so you can read it at a glance without parsing the scene. A camera HUD mode is also available, drawing a box on the nearest detection with tag markers on the rest.

This is not a general-purpose object detector. The model is fine-tuned to recognize police vehicles, so think of it as a visual counterpart to a radar detector rather than a "label everything in view" camera app. Nothing is recorded and there's no account to sign into.

## The model

Detection uses a custom **RF-DETR Small** checkpoint fine-tuned to spot police vehicles, published as ONNX at [`tuxracer/las-vegas-metro-rfdetr-small-t1`](https://huggingface.co/tuxracer/las-vegas-metro-rfdetr-small-t1). Las Vegas Metro patrol vehicles happen to make up most of the current training data, so that is what it recognizes best today, but the goal is broader police-vehicle detection and the training set will keep growing. The app streams the weights from Hugging Face on first launch and runs them on-device through onnxruntime-web (WebGPU, with a WASM fallback).

## Features

- **Radar-detector view (default)**: a signal meter that climbs as a patrol vehicle appears, with an optional beep. A camera HUD mode with a box on the nearest detection and floating tags for the rest is also available.
- **On-device detection**: inference runs in the browser through onnxruntime-web. Camera frames, images, and detection boxes never leave the device. (See [Privacy](#privacy) for the anonymous analytics that are sent.)
- **Offline PWA**: install it to the home screen; after the first launch (which downloads the model), it works with no connection.
- **WebGPU with WASM fallback**: uses the GPU when the browser supports it, and falls back to WebAssembly automatically. No setup needed either way.
- **Screen wake lock**: keeps the screen on while running, so the phone doesn't sleep mid-drive.

## Getting started

```bash
pnpm install
pnpm dev   # http://localhost:5173
```

Other commands:

```bash
pnpm build       # Production build (vite build → dist/)
pnpm start       # Serve the production build (vite preview)
pnpm test        # Run tests once (vitest run)
pnpm test:watch  # Run tests in watch mode
pnpm check       # Verify formatting + lint + typecheck
pnpm format      # Auto-fix formatting (prettier --write)
```

## Privacy

Camera frames, images, and detection boxes never leave the device. There's no account, no login, and no per-user tracking. Network traffic is limited to the app's static files (including the same-origin ONNX runtime), the one-time detection model download (huggingface.co), and anonymous analytics (Vercel).

To understand roughly how the app is used, it does send a small set of anonymous, aggregate Vercel Analytics events that are not tied to any account or identity: page views, a few usage milestones (which inference backend was selected, model ready, PWA installed, errors), and a coarse `police_detected` counter. That last event is a plain increment with no payload attached: no image, no location, nothing about the sighting itself. Like any analytics event, Vercel records when it arrives on its end, but we attach nothing beyond the fact that it happened. It tells us that a detection happened somewhere, not where, what, or by whom.

## Contact

Mastodon: [@tuxracer@fosstodon.org](https://fosstodon.org/@tuxracer)

## License

[MIT](LICENSE)
