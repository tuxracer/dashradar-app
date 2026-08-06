---
name: shipping-a-model
description: Use when changing the detection model - swapping the checkpoint, re-exporting to ONNX, adding or bumping an entry in the model registry, or altering the input/output signature the worker decodes. Holds the export requirements and the release runbook.
---

# Shipping a model

The model is a custom **RF-DETR Nano** checkpoint fine-tuned on Las Vegas Metro police vehicles, published at [`tuxracer/las-vegas-metro-rfdetr-nano`](https://huggingface.co/tuxracer/las-vegas-metro-rfdetr-nano) and trained/exported from the sibling repo `~/Development/las-vegas-metro-rfdetr-nano`. The small variant it replaced lives at [`tuxracer/las-vegas-metro-rfdetr-small`](https://huggingface.co/tuxracer/las-vegas-metro-rfdetr-small) and is still loadable through the model picker.

Mobile WebGPU is the only target and the only execution path. There is no CPU fallback and no second decode path, so a bad export ships silently and nothing catches it but a real browser. That is the whole reason this runbook exists.

## Signature the worker expects

Every selectable checkpoint is a `DetectionModel` entry naming its repo, revision, and weights file, and nothing about what the weights hold: `DEFAULT_MODEL` in `src/lib/detectionModels/consts.ts` is the entry a build ships with, and a developer can add more from the model picker. The shipping entry streams `model_fp16.onnx`, about 54 MB, mixed precision. The shapes below are that entry's.

| Tensor   | Shape           | Notes                                            |
| -------- | --------------- | ------------------------------------------------ |
| input    | `[1,3,512,512]` | fp32 NCHW                                        |
| `dets`   | `[1,100,4]`     | cxcywh, normalized                               |
| `labels` | `[1,100,2]`     | raw logits, per-query sigmoid; police at index 1 |

No NMS. The `labels` width is measured off the session and each class's index comes from the `names` map stamped into the file, so a wider head with its classes elsewhere needs no app change at all. Changes to the input shape, the box encoding, or the unused background slot are a different matter: those need matching changes in `preprocess`/`decodeDetections` in `src/workers/detection/inference.ts`.

## Export requirements

- **Keep GridSample fp32.** The WebGPU fp16 build is mixed precision with its GridSample nodes kept fp32, because pure-fp16 GridSample generated invalid WGSL under JSEP. If an export changes GridSample precision, or the WebGPU URL moves to a different build, re-verify before shipping.
- **fp16 tensors require the `shader-f16` GPU feature.** `probeWebGpu()` gates on it, along with actually acquiring an adapter and device, so unsupported devices are turned away before any download. An export that needs a different feature has to move that gate with it.
- **Decode stays hand-rolled.** Never reach for the Transformers.js `pipeline()`. The head is a sigmoid scored per class, index 0 an unused background slot (2-wide for the shipping entry); the pipeline's softmax-with-background DETR decode drops every real detection, and `RfDetrImageProcessor` isn't a registered JS processor.

## Release runbook

The `"model-cache"` Workbox route is `CacheFirst` keyed on URL, so the URL is the cache key and the revision is how a new model reaches anyone; a revision of `main` would let a mutable ref sit behind an immutable cache entry.

1. Push a new tag on the Hugging Face repo.
2. Verify the new weights URL returns 200: `curl -sIL -o /dev/null -w '%{http_code}' <url>`
3. Bump `DEFAULT_MODEL`'s `revision` in `src/lib/detectionModels/consts.ts`. The head width and the class labels are read off the loaded session and the file's `names` map, so nothing else app-side describes the checkpoint. A genuinely different checkpoint takes a new `id` too, so a stored selection is never silently repointed at a different detector.
   Stamp `names` into the export or the classes come back as `CLASS 1`, `CLASS 2`. Every class it names is live: there is no allowlist, and `hudSignal` takes the max score across every detection, so a named `person` class beeps at every pedestrian.
   Reread the entry's `summary` while you are there. It is the one line about a checkpoint written by hand rather than read from the weights, shown on the model card so someone can tell two models apart before downloading either, and a revision that changes what a model finds leaves it stale.
4. Set `CONFIDENCE_THRESHOLD` in `src/lib/detection/consts.ts` from the new release's recommended threshold, rounded to the nearest tenth. Thresholds do not carry across checkpoints: every release recalibrates its own score distribution, and a threshold read off a hosted endpoint is not the same measurement either, since hosted serves a different query count than the export. The rounding keeps the floor on the developer confidence slider's grid, which moves in tenths.
5. Verify end-to-end on WebGPU in a real browser (see the `verifying-in-browser` skill): zero GridSample or WGSL errors in the console, and a reference-image score match against the previous model.
6. Verify on a real device before calling it done. Round-trip time and thermals are the numbers that matter, and neither shows up in a desktop browser.

Testing an unreleased revision on a device needs no code change at all: paste the revision-pinned weights URL into the developer model picker's ADD MODEL row. The picker's trial load runs the same download-build-run sequence as a real load, so it covers steps 2 and 5 on that one device; still verify thermals separately, and still bump `DEFAULT_MODEL` for the release itself.
