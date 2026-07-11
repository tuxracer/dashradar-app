# dashradar

Mount a phone on your car dash and turn the camera into a live radar view. dashradar runs an object detector entirely on the phone, drawing a clean HUD over the live camera feed: a box on the nearest object, small tag markers on the rest, and a lane-radar strip that shows where things are without making you read anything. Nothing is recorded, nothing leaves the device, and there's no account to sign into.

## Features

- **Live detection HUD**: the nearest object gets a highlighted box and label; everything else gets a small floating tag. A lane-radar strip at the bottom shows left/center/right position at a glance.
- **On-device only**: detection runs in the browser via Transformers.js. No frames, detections, or video are ever sent anywhere.
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

Camera frames and detection results never leave the device: they stay in the browser tab and are never uploaded, and there's no account to sign into. Network traffic is limited to the app's static files, the one-time detection model download (huggingface.co), the ONNX runtime (cdn.jsdelivr.net), and anonymous page-view analytics (Vercel).

## Contact

Mastodon: [@tuxracer@fosstodon.org](https://fosstodon.org/@tuxracer)

## License

[MIT](LICENSE)
