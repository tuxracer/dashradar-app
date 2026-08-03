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
uses 300.

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

| Field       | What it is                                                              |
| ----------- | ----------------------------------------------------------------------- |
| `id`        | Stable key the stored selection uses. Keep it free of the revision, so a routine re-export does not reset anyone's choice. Never reuse an id for a different checkpoint. |
| `slug`      | Hugging Face repo name.                                                  |
| `revision`  | The pinned tag.                                                          |
| `file`      | ONNX filename inside the repo's `onnx/` directory.                        |
| `headWidth` | Width of the classification head, background slot included.              |
| `classes`   | The classes this build surfaces, each naming its own logit index.        |

`classes` does not have to cover the head. A checkpoint trained on 80 classes
can expose the six that matter, and a logit no entry names is never read. Each
class carries a `label` (what the model outputs), a `displayLabel` (what the HUD
shows), a `category` that picks its box color in the developer detection view,
and an `index`.

Categories are `vehicle`, `person`, `bike`, `signal`, `animal`, and `unknown`.

### What gets checked, and when

`headWidth` is declared rather than measured because a partial class table
cannot imply it. It is what pins a table to its checkpoint. Without it, a police
table naming logit 1 read against an accidentally loaded 91-wide head would find
`person` there and report it as `POLICE` on every frame, silently.

The decode rejects a model on the first scan, as `MODEL_LOAD_FAILED`, when the
label tensor's width disagrees with the declared `headWidth`, when the class
table is empty, or when any index is not a whole number inside `[1, headWidth)`.
Failing loudly is deliberate: the alternative is plausible-looking garbage.

The test suite catches the same errors in committed registry data, along with
duplicate class indices and duplicate labels, so a bad entry does not have to
reach a browser to be noticed.

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
