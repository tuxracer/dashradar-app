# Legacy

Where this app came from, and what changed when it was rewritten. Useful if you
find the old code and wonder why the current version looks nothing like it, or
why it gave up something the prototype appeared to have.

The original still exists as the `tensorflow` branch. It is kept for reference
only and is not maintained.

## The 2022 prototype

The first version was written by hand in 2022 and published in March 2023. It was
a Next.js 12 app with `next-pwa`, about a thousand lines total, with almost
everything in one page component. TensorFlow.js ran the stock
`@tensorflow-models/coco-ssd` detector on the WebGL backend, on the main thread,
against every video frame the browser offered through
`requestVideoFrameCallback`.

It was a general object detector pointed at the road rather than a police
detector. COCO has no patrol-vehicle class, so the app filtered the 80 COCO
classes down to an allowlist of things worth calling out (car, truck, person,
stop sign, dog) and announced them with the Web Speech API. The camera feed was
on screen with boxes drawn over it on a canvas, which is the opposite of what the
app does now.

Two ideas from the prototype survived the rewrite. It used RxJS, and it already
carried detection identity across frames by matching boxes on overlap, which is
the ancestor of today's coasting tracker.

## The 2026 rewrite

`main` is a full reimplementation started in July 2026. It is a Vite React SPA
with no server runtime, running a custom RF-DETR Nano checkpoint fine-tuned on
Las Vegas Metro patrol vehicles, on raw onnxruntime-web over WebGPU, inside a Web
Worker. The camera feed is never shown; the driver sees a signal meter or a 3D
scene view.

The rewrite is what made it an actual police detector rather than a car detector
with a nice UI. Everything else follows from that plus two constraints the
prototype never had to answer for: a phone clamped to a windshield in direct sun
has a thermal budget, and the app has to work offline.

| | `tensorflow` branch | `main` |
| --- | --- | --- |
| Framework | Next.js 12, `next-pwa` | Vite React SPA, Workbox |
| Runtime | TensorFlow.js, WebGL, main thread | onnxruntime-web, WebGPU, Web Worker |
| Model | Stock COCO-SSD MobileNet | Custom RF-DETR Nano, fp16 |
| Targets | 80 COCO classes, filtered by allowlist | Classes read from the checkpoint's own metadata |
| Cadence | Every video frame | Paced, with a scan floor and a rest that grows with the round trip |
| Screen | Live camera feed with boxes drawn over it | Signal meter or 3D scene; feed is never shown |
| Alerts | Spoken class names | Meter, alert ring, beeper |

## The framing difference

The one difference that surprises people: the prototype appeared to detect across
the whole 16:9 camera frame, and the current app only reads a centered square,
which is a little over half the width of a 16:9 frame.

The prototype did not really get the whole frame either. COCO-SSD does no resizing
in JavaScript, so it looks like it runs at native resolution, but the frozen
SSD MobileNet graph resizes whatever it is handed onto its own fixed 300x300
input, without preserving aspect ratio. A 1280x720 frame arrived at the first
convolution squeezed to 300x300. Full coverage, quarter resolution, and a 1.78x
horizontal squash.

That was fine for its job. "Is there a car ahead" is an easy question, and a car
ahead is enormous. Finding a patrol car far enough away to be worth warning about
is not, and it depends entirely on how many pixels land on the vehicle. The
checkpoint's own release notes measure the same vehicle in the same photo at
about 0.93 confidence when a native 512-pixel window is cropped around it, and
about 0.35 when the full frame is downscaled into 512x512. `CONFIDENCE_THRESHOLD`
sits well above the second number, so a full-frame view would not weaken distant
detections, it would erase them.

So the square crop in `centerCropRegion` is a deliberate trade of field of view
for resolution on target, and it also matches how the model was trained: the
dataset is built from square native-resolution crops, not downscaled frames.
Widening the view means either giving those pixels back or spending more
inference, and inference is the thermal budget. Any proposal to cover more of the
frame has to say which of the two it is paying with.
