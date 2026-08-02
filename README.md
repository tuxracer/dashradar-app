# 🚔 dashradar.app

Turn your phone into an on-device, computer-vision police detector, spotting patrol vehicles on the road in real time. Mount it on the dash and it watches the road through the camera. Everything runs on the phone.

A custom model, fine-tuned to recognize patrol vehicles, drives a glanceable instrument: a signal meter climbs as a police vehicle comes into view, with an optional beep, so you read it at a glance without ever taking your eyes off the road. Nothing is recorded, and there's no account.

## Why on-device

Crowd-sourced apps like Waze depend on a large, active userbase reporting sightings in real time. They are only as good as the crowd nearby, they need a live network connection, and a single user on a quiet road sees nothing. dashradar takes the opposite approach: it looks at the road itself. Detection runs entirely on the phone, so it needs no network, no crowd, and no other users. It works on the first drive, for the first user, anywhere the camera can see the road.

## Why not send frames to a cloud model

A hosted vision model would probably identify a patrol vehicle in any single photo more accurately than anything that fits on a phone. It still doesn't fit this problem.

Detection here is not press a button and get an answer. The app scans continuously for the whole drive, a frame at least every second, which is thousands of images an hour for one driver. Someone has to pay for every one of them, so either the driver brings an API key or the app stops being free. Speed rules it out separately: a round trip to a hosted model rarely comes back in under a second, so each scan would be waiting on the previous answer, and the gaps between them are blind spots on a road that moved while the request was in flight.

The privacy cost is the bigger one. Streaming the view out of the windshield to a third party turns a tool for noticing patrol cars into a running record of where someone drove and what they passed. An app meant to help a driver should not be the thing watching them, so frames stay on the device.

What's left is the harder version of the problem: a model small enough to run in a browser on a phone GPU, accurate enough to be worth glancing at, and quick enough to finish before the next scan starts. That constraint shapes most of what is in this repo.

## Features

- **Radar-detector view**: a signal meter that climbs as a patrol vehicle appears, with an optional beep. Glanceable, no scene to parse.
- **On-device detection**: inference runs in the browser through onnxruntime-web. Camera frames and detections never leave the device. (See [Privacy](#privacy).)
- **Offline PWA**: install it to the home screen and it works with no connection after the first launch.
- **WebGPU accelerated**: inference runs on the phone's GPU, which is what keeps a scan under a second. Devices without WebGPU are told so up front rather than handed a detector too slow to be useful. No setup either way.
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

## The model

Detection uses a custom **RF-DETR Small** checkpoint published as ONNX at [`tuxracer/las-vegas-metro-rfdetr-small`](https://huggingface.co/tuxracer/las-vegas-metro-rfdetr-small). It recognizes Las Vegas Metro patrol vehicles best today, since they make up most of the training data, but the training set keeps growing toward broader police-vehicle detection. The app streams the weights from Hugging Face on first launch and runs them on-device through onnxruntime-web.

## Privacy

Camera frames, images, and detection boxes never leave the device. No account, no login, no per-user tracking. Network traffic is limited to the app's static files (including the same-origin ONNX runtime), the one-time model download (huggingface.co), and anonymous analytics (Vercel).

The analytics are aggregate and tied to no identity: page views, a few usage milestones (model ready, PWA installed, errors), and a coarse `police_detected` counter. That counter is a plain increment with no payload: no image, no location, nothing about the sighting. It tells us a detection happened somewhere, not where, what, or by whom.

## Contact

Mastodon: [@tuxracer@fosstodon.org](https://fosstodon.org/@tuxracer)

## License

[MIT](LICENSE)
