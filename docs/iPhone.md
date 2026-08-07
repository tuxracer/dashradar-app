# iPhone crashes

Status as of August 2026: dashradar crashes frequently on iPhones. Every Android device we have tested runs without issue. The root cause is not yet fully established. This documents the symptom, the evidence collected so far, what has been ruled out, the mitigations and instrumentation shipped, and the suspects that remain.

## The symptom

Two visible failure shapes, both on iPhone Safari:

- **Silent force reload.** The tab reloads on its own and asks for camera permission again, then everything continues working. This is Safari recovering from a single kill of the tab's WebContent process; the permission re-ask is the tell that the process really died, since camera grants are per-process on iOS.
- **"A problem repeatedly occurred."** Safari stops auto-reloading after consecutive kills of the same page in a short window and shows its error page instead.

The crashes are intermittent: sometimes the app scans for a long time without one, other times it dies repeatedly within ~10 seconds of opening. Crashes have been seen on several iPhone models; most testing has been on an iPhone 16e (iPhone17,5, iOS 26.4), which also crashes. Note that Sentry's `os` tag reports these devices as "iOS 18.7" because Safari froze its user agent; do not trust that tag for iOS versions.

## Evidence

- **Sentry issue DASHRADAR-2** (the crash sentinel's next-launch reports, see the crash sentinel section of the [TRD](TRD.md)): kills land 5 to 30 seconds into scanning, 8 to 11 scans in, with round trips healthy (250 to 280 ms) up to the final second. Nothing degrades first; the page is simply gone.
- **A jetsam log for one kill** (`JetsamEvent-2026-08-07-125154.ips`): `com.apple.WebKit.WebContent`, frontmost, killed for `per-process-limit` at 2.0 GiB resident, 1.8 GiB of it anonymous memory. The GPU process peaked at ~130 MiB, so the memory was in the content process, not GPU-side. The killed process was 267 seconds old with only 31 seconds of CPU: it had lived through several page loads before dying.
- **A tethered Web Inspector session**: the ONNX runtime's wasm heap sat flat at 127.4 MiB across every scan, every view switch, and, in one captured kill, at the moment of death itself (the sentinel's `wasmHeapBytes`). The owned-bitmap count was 0 at death. Successive page loads inside one WebContent process survived 49, 110, 31, then 10 scans before the kill: each reload shortened the next session's life.
- **Not every kill leaves a jetsam log.** The kills without one were something other than the memory limit, most likely a WebContent crash or the GPU process dying under the page.

## Ruled out

| Hypothesis                             | How it was ruled out                                                                     |
| -------------------------------------- | ---------------------------------------------------------------------------------------- |
| Per-scan wasm heap growth              | Measured flat at 127.4 MiB across long sessions and in the dying session's last heartbeat |
| App-side ImageBitmap leak              | The engine counts every owned bitmap; the count was 0 at every kill                       |
| WebGPU graph capture                   | Disabled on WebKit; crashes continue unchanged, and most early crashes had it off already |
| GPU process memory                     | ~130 MiB at the moment WebContent died at 2.0 GiB                                         |
| The worker recycle path                | Every crash so far had zero recycles and a worker 11 to 17 seconds old                    |
| One specific view                      | Kills recorded under both the radar dial and the 3D scene                                 |
| Thermal or pacing degradation          | Round trips stay flat right up to the kill; a thermal death slows down first              |

## Mitigations shipped

- **Worker terminated on `pagehide`.** WebKit reuses one WebContent process across same-site reloads and reclaims a departed page's worker (its wasm memory, ONNX session, GPU handles) lazily at best, so each reload stacked a dead page's residue onto the process. Terminating before departure hands that memory back deterministically; a bfcache restore reactivates the engine. This targets the leading hypothesis below.
- **Periodic worker recycle** (pre-existing): the worker is rebuilt every 15 minutes to bound native memory growth within one session.

## Instrumentation added

- The crash sentinel heartbeat now records the wasm heap size, owned bitmaps, worker age, recycle count, and a rolling log of what the engine did, and it survives an error halt, so a GPU device loss moments before a kill still reaches the next launch's report with its loss reason.
- A **Console diagnostics** developer option mirrors the session log to the console live (each scan line carries round trip, wasm heap, and bitmap count) for tethered Web Inspector sessions, and a dirty end is always replayed to the console at the next launch, because a kill takes the dead process's inspector console with it.

## Leading hypothesis

**Cross-reload residue in the reused WebContent process.** Each page instance of the app plausibly costs WebKit 400 to 500 MiB (wasm heap, model weights, ONNX session, WebGPU staging, JS heap). Reloads do not give the departed instance's share back promptly, so a handful of reloads walks the process into its 2 GiB cap, and the kill lands on whichever page happens to be running, a few scans in. This fits the jetsam numbers, the shortening session lives (49, 110, 31, 10), the flat in-page heap, and the way one long session without reloads runs indefinitely. It also makes the crash loop partly self-sustaining: each silent force reload is itself another reload.

## Remaining suspects

1. **WebKit not reclaiming departed pages across same-site reloads** (leading, above). The pagehide termination targets it; whether it flattens the shortening-sessions decay on the phone is the current open test.
2. **A second, non-memory killer** behind the kills that leave no jetsam log: a WebContent crash (look for `WebContent-*.ips` files in Analytics Data) or the GPU process dying under the page (the sentinel now records the device-lost reason when the page survives long enough to see it).
3. **WebGPU buffer mappings accounted to WebContent.** WebKit backs `GPUBuffer` staging in the content process, where it is invisible to the in-page heap metric but counts against the process cap.
4. **Safari 26 WebGPU maturity in general.** onnxruntime-web 1.27's WebGPU path is far younger on WebKit than on Chromium; worth checking upstream for WebKit-specific fixes before pinning blame locally.

## Gathering more evidence

- **Tethered Web Inspector**: enable Developer options and Console diagnostics on the phone, tether to desktop Safari, keep the console preserving log across navigations, and watch the per-scan heap lines. After a kill, the auto-reloaded page replays the dead session's tail.
- **On-device kill logs**: Settings → Privacy & Security → Analytics & Improvements → Analytics Data. A `JetsamEvent-*` file means a memory kill and names the process, reason, and size; a `WebContent-*.ips` file means a crash. Each kill can be classified this way.
- **The reload-loop experiment**: force-quit Safari, let one session scan for several minutes (it should not crash), then reload repeatedly. Before the pagehide termination this walked the process into a kill within a handful of cycles; whether it still does is the test that confirms or breaks the leading hypothesis.
