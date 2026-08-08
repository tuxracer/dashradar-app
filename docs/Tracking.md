# Tracking: object identity between scans

How the app decides that a detection in this scan is the same object it saw in the previous one. The tracker lives in `src/lib/detectionTracker`, pure and unit-tested; the engine steps it once per scan and publishes the result as `scan.tracks`. This page covers what identity is used for, why the current matcher degrades at the app's scan cadence, and the order the improvements should land in.

## What an id is worth

Alerting does not use identity. The meter, the alert ring, and the beeper read the frame's top score whatever object it belongs to, so a broken match never misses a police car. Identity buys continuity in the presentation:

- The scene view glides a glyph between fixes instead of re-creating it each scan, and the glyph's color is seeded from the id.
- A matched track eases its score toward the new value, damping jitter before it reaches the meter.
- An unmatched track coasts for `MAX_COAST_MS`, so one missed detection does not flicker the box and the alert behind it.

A wrongly minted id therefore costs a glyph popping instead of gliding, a color change mid-drive, and a smoothing reset. Real costs, but presentation costs, which bounds how much machinery the problem deserves.

## Why the current matcher degrades

Matching is greedy IoU against the box where each track was last seen, gated at `IOU_MATCH_THRESHOLD`, same class only. That shape is right at video rate, where an object barely moves between frames. Thermal pacing instead spaces scans at least a second apart and up to five, and three things go wrong at that cadence:

1. **Displacement.** A vehicle with real relative speed moves far in image space in a second. Its new box overlaps its old one weakly or not at all, so the true match scores below the gate.
2. **Zero carries no signal.** IoU of 0 says nothing about how near a miss was. Every non-overlapping candidate ties, so the matcher cannot even prefer the closer one.
3. **Order-dependent greed.** The first detection claims its best track even when a later detection fits that track better. Ambiguity between same-class candidates grows with the gap, so the swaps this causes get more likely exactly when matching is hardest.

## Matching as four slots

Any matcher answers four questions, and each answer is a separable piece of the code:

| Slot   | Question                                | Today                   | Upgrade                                             |
| ------ | --------------------------------------- | ----------------------- | --------------------------------------------------- |
| Predict | Where should this track be by now?      | Its last seen box       | Constant-velocity extrapolation, per millisecond    |
| Score  | How well does a detection fit a track?  | IoU                     | IoU of the predicted box, plus a center-distance term |
| Gate   | When is a match good enough to accept?  | Fixed threshold         | Threshold that loosens with time since last seen    |
| Assign | Who wins when candidates compete?       | Detection-order greedy  | Best pair first across all track/detection pairs    |

The slots are why the upgrades compose instead of competing: each one replaces a different answer.

## The first change: all four geometric slots at once

The four upgrades ship as one change because each is crippled alone. Prediction without a distance term still scores an uninformative zero when the extrapolation is slightly off at a long gap. A distance term without prediction measures distance from a place the object predictably is not anymore. The loosening gate has nothing principled to loosen around until there is a prediction whose uncertainty actually grows with elapsed time. And best-pair-first matters most once the score is informative enough to rank near ties.

Two constraints on the implementation:

- **Velocity is per millisecond, never per frame.** Scans arrive anywhere between the pacing floor and cap, so anything derived from "the last two frames" must be normalized by the real elapsed time between them, and the prediction scaled by the real time since.
- **It stays pure math.** A handful of boxes once per scan, in the existing pure module, unit-tested directly. No thermal cost, no new state outside the track record.

## Later, only on evidence from real drives

**Appearance tiebreaker.** When two same-class candidates are geometrically ambiguous, two cars side by side, a coarse color signature per detection (a small downsample of the box crop) can break the tie as one more term in the pair score. It needs a new field through the worker protocol, so it is its own change, and it waits until drives with the geometric matcher still show swaps.

**Ground-plane prediction.** `scenePlacement` already projects boxes to ground coordinates through a pinhole model. Vehicle motion is far more linear there than in image space, where an approaching car's box grows nonlinearly, so predicting in ground coordinates and reprojecting would make the constant-velocity assumption more honest. This replaces the Predict slot's coordinate space; the other slots carry over unchanged. The open problem is ego-motion, since the phone has no speed input, so this waits until the image-space version proves too crude.

## Off the table

Anything that adds work between scans: optical flow, template tracking, or a re-identification network. The scan cadence exists to keep a dash-mounted phone inside its thermal budget, and identity is a presentation concern; it does not get to spend inference-scale watts.
