# CLAUDE.MD - DashRadar App

## Project Overview

**DashRadar** is a Next.js web application that provides real-time object detection using a webcam feed. The app uses TensorFlow.js with the COCO-SSD model to identify objects in the camera view and provides audio feedback through text-to-speech capabilities.

**Status**: Early prototype / Proof of concept - code needs cleanup

**Key Features**:
- Real-time object detection via webcam
- TensorFlow.js COCO-SSD model integration
- Text-to-speech announcements for detected objects
- Visual overlay with emoji representations
- Dark mode support

## Tech Stack

- **Framework**: Next.js 12.3.1
- **Runtime**: React 18.2.0
- **Language**: TypeScript 4.8.4
- **ML/AI**:
  - @tensorflow/tfjs ^4.0.0
  - @tensorflow-models/coco-ssd ^2.2.2
- **UI**: @nextui-org/react ^1.0.0-beta.12
- **Additional Features**:
  - Text-to-speech: tesseract.js ^3.0.3
  - PWA support: next-pwa ^5.6.0
  - Analytics: fathom-client ^3.5.0
  - State management: RxJS ^7.8.0

## Project Structure

```
.
├── components/          # React components
│   └── Loading/        # Loading component
├── lib/                # Core utilities
│   ├── tf.ts          # TensorFlow detection logic
│   ├── webcam.ts      # Webcam stream handling
│   ├── speak.ts       # Text-to-speech utilities
│   └── utils.ts       # General utilities
├── observables/        # RxJS observables
├── pages/              # Next.js pages
│   ├── index.tsx      # Main app page
│   ├── _app.tsx       # App wrapper
│   └── api/           # API routes
├── public/             # Static assets
└── styles/             # CSS styles
```

## Development

### Setup

```bash
npm install
```

### Run Development Server

```bash
npm run dev
```

Open http://localhost:3000

### Build for Production

```bash
npm run build
```

### Start Production Server

```bash
npm start  # Runs on port 3001
```

### Lint

```bash
npm run lint
```

## Key Implementation Details

### Object Detection Flow

1. **Webcam Stream**: The app requests camera access and streams video to a `<video>` element
2. **TensorFlow Processing**: COCO-SSD model analyzes video frames to detect objects
3. **Detection Observable**: RxJS observable (`getDetectedObjects$`) emits detected objects
4. **Canvas Overlay**: Detected objects are drawn on a canvas overlay with bounding boxes and emojis
5. **Audio Feedback**: Text-to-speech announces detected objects (throttled to prevent spam)

### Notable Files

- `pages/index.tsx`: Main component with video/canvas rendering and detection visualization
- `lib/tf.ts`: TensorFlow model loading and object detection logic
- `lib/webcam.ts`: Webcam stream initialization
- `lib/speak.ts`: Text-to-speech implementation
- `lib/utils.ts`: Color utilities, dark mode detection, window reload helpers

### Emoji Mapping

The app maps detected object classes to emoji representations:
- person → 👤
- dog → 🐕
- cat → 🐈
- traffic light → 🚦
- stop sign → 🛑
- etc.

## Known Issues & TODOs

See: https://git.fedi.ai/tuxracer/dashradar-app/issues

The main page component (`pages/index.tsx:57`) notes:
> "NEEDS REFACTOR into smaller separate components / custom hooks"

## Working with AI Assistants

### Common Tasks

1. **Adding New Detected Object Types**: Update the `emojiMap` in `pages/index.tsx`
2. **Adjusting Detection Threshold**: Modify `UNKNOWN_THRESHOLD` in `lib/tf.ts`
3. **Customizing Speech**: Edit throttle timing or text in `lib/speak.ts`
4. **UI Changes**: Components use NextUI, check their documentation
5. **Model Configuration**: TensorFlow settings in `lib/tf.ts`

### Before Making Changes

- The codebase is acknowledged as messy POC code
- Prefer refactoring into smaller components/hooks
- Test with actual webcam since this is a camera-dependent app
- Be mindful of performance - real-time detection is CPU-intensive

### Testing Considerations

- Requires webcam access (browser permissions)
- Best tested in actual browser, not headless
- Performance varies by device/GPU
- Speech synthesis availability varies by browser/OS

## Git Repository

Main: https://git.fedi.ai/derek/dashradar-app
Issues: https://git.fedi.ai/tuxracer/dashradar-app/issues

## Additional Notes

- The app is a PWA (Progressive Web App) with offline capabilities via next-pwa
- Uses Fathom for privacy-friendly analytics
- Original package name is "car-radar" (visible in package.json)
- Runs on port 3001 in production to avoid conflicts
