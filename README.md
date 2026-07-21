# 🚔 dashradar.app

Turn your phone into an on-device, computer-vision police detector, spotting patrol vehicles on the road in real time. Mount it on the dash and it watches the road through the camera. Everything runs on the phone.

A custom model, fine-tuned to recognize patrol vehicles, drives a glanceable instrument: a signal meter climbs as a police vehicle comes into view, with an optional beep, so you read it at a glance without ever taking your eyes off the road. Nothing is recorded, and there's no account.

## The model

Detection uses a custom **RF-DETR Small** checkpoint published as ONNX at [`tuxracer/las-vegas-metro-rfdetr-small-t1`](https://huggingface.co/tuxracer/las-vegas-metro-rfdetr-small-t1). It recognizes Las Vegas Metro patrol vehicles best today, since they make up most of the training data, but the training set keeps growing toward broader police-vehicle detection. The app streams the weights from Hugging Face on first launch and runs them on-device through onnxruntime-web.

## Why on-device

Crowd-sourced apps like Waze depend on a large, active userbase reporting sightings in real time. They are only as good as the crowd nearby, they need a live network connection, and a single user on a quiet road sees nothing. dashradar takes the opposite approach: it looks at the road itself. Detection runs entirely on the phone, so it needs no network, no crowd, and no other users. It works on the first drive, for the first user, anywhere the camera can see the road.

## Features

- **Radar-detector view**: a signal meter that climbs as a patrol vehicle appears, with an optional beep. Glanceable, no scene to parse.
- **On-device detection**: inference runs in the browser through onnxruntime-web. Camera frames and detections never leave the device. (See [Privacy](#privacy).)
- **Offline PWA**: install it to the home screen and it works with no connection after the first launch.
- **WebGPU with WASM fallback**: uses the GPU when available, falls back to WebAssembly automatically. No setup either way.
- **Screen wake lock**: keeps the screen on so the phone doesn't sleep mid-drive.

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

Camera frames, images, and detection boxes never leave the device. No account, no login, no per-user tracking. Network traffic is limited to the app's static files (including the same-origin ONNX runtime), the one-time model download (huggingface.co), and anonymous analytics (Vercel).

The analytics are aggregate and tied to no identity: page views, a few usage milestones (inference backend, model ready, PWA installed, errors), and a coarse `police_detected` counter. That counter is a plain increment with no payload: no image, no location, nothing about the sighting. It tells us a detection happened somewhere, not where, what, or by whom.

## Contact

Mastodon: [@tuxracer@fosstodon.org](https://fosstodon.org/@tuxracer)

## License

[MIT](LICENSE)
