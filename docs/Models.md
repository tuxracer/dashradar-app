# Models

What a detection model has to be for this app to load it. The app runs the model
in a Web Worker through onnxruntime-web on WebGPU, with no server and no second
execution path, so a model that misses any of this fails on the device rather
than in CI.

The decode is hand-rolled for a DETR-style set predictor. Anything with a
different output shape needs code changes in `src/workers/detection/inference.ts`
as well as a registry entry.

## Tensor signature

One input, two outputs.

| Tensor   | Shape             | Type | Notes                                     |
| -------- | ----------------- | ---- | ----------------------------------------- |
| input    | `[1,3,512,512]`   | fp32 | NCHW, ImageNet mean/std normalized        |
| `dets`   | `[1,N,4]`         | fp32 | cxcywh, normalized 0..1                   |
| `labels` | `[1,N,headWidth]` | fp32 | raw logits, no softmax applied            |

`N` is the query count and is read from the tensor lengths, not their declared
dims, so a dynamic axis is fine as long as both outputs agree on it. RF-DETR
defaults to 300; the shipping export re-exports at 100.

Name the outputs `dets` and `labels`. The worker looks for those names and only
falls back to output order if they are absent, so unnamed outputs work but
depend on the exporter emitting them in the right order.

Input size is fixed at 512 across the whole capture path. The camera is asked
for roughly 1024 pixels per axis so the 2x zoom crop lands at 512 native with no
upscaling, and the zoom stops at 2x for the same reason. A model expecting a
different resolution needs more than a registry entry.

## The classification head

`labels` carries raw per-class logits. The decode applies sigmoid per class and
takes the highest scorer for each query, so one box gets one label. Logit index
0 is treated as an unused background slot and is never read.

There is no NMS and none is expected. RF-DETR is set-based, so duplicate
suppression is the model's job.

A softmax-with-background head will not work. Its decode assigns each query an
arg-max label across a distribution that includes background, which drops every
real detection under a sigmoid decode. This is also why the app uses
onnxruntime-web directly rather than the Transformers.js `pipeline()`.

## Precision and WebGPU

The shipping export is mixed precision: fp16 weights and compute, fp32 inputs
and outputs, and its three GridSample nodes kept fp32 behind boundary casts.

**Keep GridSample fp32.** The WebGPU GridSample kernel emits an `f32 * f16`
multiply for fp16 tensors, which WGSL forbids. A pure-fp16 export does not fail
loudly; it silently produces wrong detections. GridSample has no weights, so
holding those nodes at fp32 costs nothing.

Every device is gated on the `shader-f16` GPU feature before a byte is
downloaded, and that gate is not per model. An fp32-only export is still turned
away on hardware without `shader-f16`, so shipping fp32 to widen device support
does not work without moving the gate too.

## Where the weights live

The registry builds one URL per model:

```
https://huggingface.co/<account>/<slug>/resolve/<revision>/onnx/<file>
```

Three things follow from that shape.

**The file has to sit under `onnx/` in the repo.** The path segment is not
configurable per entry.

**The account is one constant** (`MODEL_OWNER` in
`src/lib/detectionModels/consts.ts`), so every model resolves under the same
Hugging Face account. Loading a model from somewhere else means changing that
constant or mirroring the weights.

**Pin an immutable revision tag, never `main`.** The service worker caches
weights `CacheFirst` keyed on the URL, so a mutable ref would sit behind an
immutable cache entry and a new export would never reach anyone who had already
loaded the old one. Changing the tag changes the URL, which is what makes a
release land. The host also has to be `huggingface.co`; that is what the cache
route matches on.

## Registering it

A model is one entry in `DETECTION_MODELS` in `src/lib/detectionModels/consts.ts`.

| Field      | What it is                                                               |
| ---------- | ------------------------------------------------------------------------ |
| `id`       | Stable key the stored selection uses. Keep it free of the revision, so a routine re-export does not reset anyone's choice. Never reuse an id for a different checkpoint. |
| `slug`     | Hugging Face repo name.                                                   |
| `revision` | The pinned tag.                                                           |
| `file`     | ONNX filename inside the repo's `onnx/` directory.                        |

That is the whole entry. It says which bytes to fetch and nothing about what
they contain, because everything else is read from the bytes themselves at load.

### Name your classes in the file

Stamp a `names` entry into the ONNX `metadata_props`: a map of logit index to
label, such as `{1: 'police'}`. Ultralytics writes these with Python's `str()`,
and the app reads that dialect and JSON alike. It is the only machine-readable
record of what a slot means, and the app reads its class table from it. A label
is drawn on the HUD exactly as the file spells it, in an uppercase register, so
keep them short and readable: `fire_truck` reads as FIRE_TRUCK, `fire truck` as
FIRE TRUCK.

Every class the map names is live. There is no allowlist and no per-class alert
setting, and `hudSignal` takes the max score across every detection regardless
of class, so a class you name drives the dial, the alert ring, and the beeper.
Name a `person` class and the meter pins at every pedestrian.

A file that names nothing still loads and still detects. Every slot in its head
gets a generic `class 1`, `class 2` label instead, which costs the words on the
contact card and nothing else, since the meter reads scores rather than labels.

### What gets checked, and when

The head width is measured, never declared: both load paths run the model once
before reporting ready, so the `labels` output's own shape says how wide the head
is. The class labels come from the same file as the logits they index, so the two
cannot disagree, which is why nothing here is declared for a mismatch to be
caught against. A named index the head cannot hold is dropped at load rather than
read past the end of the tensor.

The load fails with `MODEL_LOAD_FAILED`, before the camera is asked for, when
`labels` is not shaped `[batch, queries, classes]` or the head has no room for a
class beside the background slot. The decode then rejects a frame whose two
output tensors disagree about the query count. Failing loudly is deliberate: the
alternative is plausible-looking garbage.

## Budget

The shipping model is about 57 MB. Each registered model is a full checkpoint
against the origin's storage quota, and the cache route holds four entries.

Inference runs at most once a second on a phone clamped to a windshield in
direct sun, which is close to the worst thermal environment a phone sees. A
model whose round trip is much slower than the current one does not just feel
sluggish, it thins out how much of the road gets scanned. Measure round trip and
thermals on a real device, not a desktop browser.

## Verifying

None of this is covered by the test suite. jsdom cannot run the worker,
inference, or the camera, so a green suite says nothing about whether a model
works. Check on real hardware:

1. The weights URL returns 200.
2. The app reaches the scanning state and the console shows no GridSample or
   WGSL errors.
3. A known image produces the detection you expect, with the label you expect.
   A wrong label means a wrong class index, and it is the failure most likely to
   look like success.
4. Round trip and thermals on a phone.

See [TRD.md](TRD.md) for how the worker, the frame pump, and the model registry
fit together.
