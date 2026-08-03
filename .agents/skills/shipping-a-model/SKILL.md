---
name: shipping-a-model
description: Use when changing the detection model - swapping the checkpoint, re-exporting to ONNX, adding or bumping an entry in the model registry, or altering the input/output signature the worker decodes. Holds the export requirements and the release runbook.
---

# Shipping a model

The model is a custom **RF-DETR Small** checkpoint fine-tuned on Las Vegas Metro police vehicles, published at [`tuxracer/las-vegas-metro-rfdetr-small`](https://huggingface.co/tuxracer/las-vegas-metro-rfdetr-small) and trained/exported from the sibling repo `~/Development/las-vegas-metro-rfdetr-small`.

Mobile WebGPU is the only target and the only execution path. There is no CPU fallback and no second decode path, so a bad export ships silently and nothing catches it but a real browser. That is the whole reason this runbook exists.

## Signature the worker expects

Every selectable checkpoint is one entry in `src/lib/detectionModels/consts.ts`, naming the repo, revision, weights file, head width, and classes. The shipping entry streams `model_fp16.onnx`, about 57 MB, mixed precision. The shapes below are that entry's.

| Tensor   | Shape           | Notes                                            |
| -------- | --------------- | ------------------------------------------------ |
| input    | `[1,3,512,512]` | fp32 NCHW                                        |
| `dets`   | `[1,300,4]`     | cxcywh, normalized                               |
| `labels` | `[1,300,2]`     | raw logits, per-query sigmoid; police at index 1 |

No NMS. The `labels` width and each class's index are the checkpoint's, declared by its entry rather than baked into the decode, so a wider head with its classes elsewhere is just a different entry. Changes to the input shape, the box encoding, or the unused background slot are a different matter: those need matching changes in `preprocess`/`decodeDetections` in `src/workers/detection/inference.ts`.

## Export requirements

- **Keep GridSample fp32.** The WebGPU fp16 build is mixed precision with its three GridSample nodes kept fp32, because pure-fp16 GridSample generated invalid WGSL under JSEP. If an export changes GridSample precision, or the WebGPU URL moves to a different build, re-verify before shipping.
- **fp16 tensors require the `shader-f16` GPU feature.** `probeWebGpu()` gates on it, along with actually acquiring an adapter and device, so unsupported devices are turned away before any download. An export that needs a different feature has to move that gate with it.
- **Decode stays hand-rolled.** Never reach for the Transformers.js `pipeline()`. The head is a sigmoid scored per class, index 0 an unused background slot (2-wide for the shipping entry); the pipeline's softmax-with-background DETR decode drops every real detection, and `RfDetrImageProcessor` isn't a registered JS processor.

## Release runbook

The `"model-cache"` Workbox route is `CacheFirst` keyed on URL, so the URL is the cache key and the revision is how a new model reaches anyone; a revision of `main` would let a mutable ref sit behind an immutable cache entry.

1. Push a new tag on the Hugging Face repo.
2. Verify the new weights URL returns 200: `curl -sIL -o /dev/null -w '%{http_code}' <url>`
3. Bump the entry's `revision` in `src/lib/detectionModels/consts.ts`. A genuinely different checkpoint is a new entry with a new `id` rather than an edit to an existing one, so a stored selection is never silently repointed at a different detector. Read the entry's `headWidth` off the export's actual `labels` width rather than guessing. The worker measures the real width off the session either way, so a declared one is an assertion about which checkpoint the class indices were written against: a wrong value fails the load, which is loud, while omitting it accepts whatever head loaded and points the table's indices at another checkpoint's classes, silently. Registered entries declare it. `classes` picks which of those logits this build surfaces, by index; an unnamed logit is never read.
4. Verify end-to-end on WebGPU in a real browser (see the `verifying-in-browser` skill): zero GridSample or WGSL errors in the console, and a reference-image score match against the previous model.
5. Verify on a real device before calling it done. Round-trip time and thermals are the numbers that matter, and neither shows up in a desktop browser.

Only one model has ever been registered, so the change that adds the second entry is the first time two paths run outside a test: the model screen's save, confirm, and reload, and a second model earning its own `"model-cache"` entry. Give both a real-browser pass on that change.
