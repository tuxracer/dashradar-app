# dashradar

A computer-vision radar detector. Mount a phone on your car dash, and dashradar watches the road through the camera for one specific thing: Las Vegas Metro police vehicles. It runs a custom object detector entirely on the phone and draws a clean HUD over the live camera feed: a box on the nearest detection, small tag markers on the rest, and a lane-radar strip that shows where things are without making you read anything. Nothing is recorded, nothing leaves the device, and there's no account to sign into.

This is not a general-purpose object detector. The model is fine-tuned to recognize marked Las Vegas Metro patrol vehicles, so think of it as a visual counterpart to a radar detector rather than a "label everything in view" camera app.

## The model

Detection uses a custom **RF-DETR Small** checkpoint fine-tuned on Las Vegas Metro police vehicles, published as ONNX at [`tuxracer/las-vegas-metro-rfdetr-small-t1`](https://huggingface.co/tuxracer/las-vegas-metro-rfdetr-small-t1). The app streams the weights from Hugging Face on first launch and runs them on-device through onnxruntime-web (WebGPU, with a WASM fallback). Swapping in a checkpoint trained on a different vehicle set is the intended way to point dashradar at another jurisdiction.

## Features

- **Purpose-built detection HUD**: a confirmed detection gets a highlighted box and label; additional detections get small floating tags. A lane-radar strip at the bottom shows left/center/right position at a glance.
- **On-device only**: detection runs in the browser through onnxruntime-web. No frames, detections, or video are ever sent anywhere.
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

Camera frames and detection results never leave the device: they stay in the browser tab and are never uploaded, and there's no account to sign into. Network traffic is limited to the app's static files (including the same-origin ONNX runtime), the one-time detection model download (huggingface.co), and anonymous page-view analytics (Vercel).

## Contact

Mastodon: [@tuxracer@fosstodon.org](https://fosstodon.org/@tuxracer)

## License

[MIT](LICENSE)
