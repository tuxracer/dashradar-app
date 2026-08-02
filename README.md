# 🚔 dashradar.app

Turn a dash-mounted phone into an on-device, computer-vision police detector. A custom model watches the road through the camera and drives a signal meter that climbs as a patrol vehicle comes into view, with an optional beep. You read it at a glance; your eyes stay on the road.

No account, no recording, no images leave the phone.

## Why on-device

Crowd-sourced apps like Waze are only as good as the crowd nearby: no alert reaches you until another driver has flagged that patrol car over a live connection. This app looks at the road itself, so it works on the first drive, for the first user, anywhere the camera can see.

Sending each frame to a cloud vision model like Claude or ChatGPT doesn't fit either. This isn't take a photo, get an answer: nobody taps anything, and the camera is scanned on its own about once a second for as long as the drive lasts. That's thousands of frames an hour someone would have to pay for, every round trip is a blind spot on a road that already moved, and everything the phone's camera sees while the app is open would land on someone else's servers.

So one of the challenges this app takes on is doing the detection on-device: in the browser, on the phone's GPU, with frames that never leave the device.

## Features

- **Glanceable signal meter** that climbs as a patrol vehicle appears, with an optional beep. No scene to parse, no map to study.
- **Fully on-device**: inference runs in the browser through onnxruntime-web on WebGPU, finishing each scan in under a second. Devices without WebGPU are told so up front instead of handed a detector too slow to be useful.
- **Offline PWA**: install it to the home screen and it works with no connection after the first launch.
- **Screen wake lock** so the phone doesn't sleep mid-drive.

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

A custom **RF-DETR Small** checkpoint, published as ONNX at [`tuxracer/las-vegas-metro-rfdetr-small`](https://huggingface.co/tuxracer/las-vegas-metro-rfdetr-small). It recognizes Las Vegas Metro patrol vehicles best today, since they make up most of the training data, and the training set keeps growing toward broader coverage. The app streams the weights from Hugging Face on first launch.

## Privacy

Camera frames, images, and detection boxes never leave the device. No account, no login, no per-user tracking. Network traffic is limited to the app's static files, the one-time model download (huggingface.co), and anonymous aggregate analytics (Vercel): page views, a few usage milestones, and a bare `police_detected` counter that carries no image, no location, nothing about the sighting.

## Contact

Mastodon: [@tuxracer@fosstodon.org](https://fosstodon.org/@tuxracer)

## License

[MIT](LICENSE)
