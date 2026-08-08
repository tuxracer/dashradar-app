# Tracking: object identity between scans

How the app decides that a detection in this scan is the same object it saw in the previous one. The tracker lives in `src/lib/detectionTracker`, pure and unit-tested; the engine steps it once per scan and publishes the result as `scan.tracks`. This page covers what identity is used for, how the matcher is shaped by the app's scan cadence, and the follow-ups held back until real drives demand them.

## What an id is worth

Alerting does not use identity. The meter, the alert ring, and the beeper read the frame's top score whatever object it belongs to, so a broken match never misses a police car. Identity buys continuity in the presentation:

- The scene view glides a glyph between fixes instead of re-creating it each scan, and the glyph's color is seeded from the id.
- A matched track eases its score toward the new value, damping jitter before it reaches the meter.
- An unmatched track coasts for `MAX_COAST_MS`, so one missed detection does not flicker the box and the alert behind it.

A wrongly minted id therefore costs a glyph popping instead of gliding, a color change mid-drive, and a smoothing reset. Real costs, but presentation costs, which bounds how much machinery the problem deserves.

## What the scan cadence does to matching

Thermal pacing spaces scans at least a second apart and up to five. Matching a detection to the box where its track was last seen, the natural approach at video rate, fails here in three ways, and each shaped one part of the matcher:

1. **Displacement.** A vehicle with real relative speed moves far in image space in a second, so its new box can overlap its old one weakly or not at all.
2. **Zero carries no signal.** An IoU of 0 says nothing about how near a miss was. Every non-overlapping candidate ties, so overlap alone cannot even prefer the closer one.
3. **Contention.** Ambiguity between same-class candidates grows with the gap, so who-gets-matched-first ordering effects cause id swaps exactly when matching is hardest.

## The matcher, as four slots

Any matcher answers four questions; each answer here is a separable piece of the code:

| Slot    | Question                               | Answer                                                                                              |
| ------- | -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Predict | Where should this track be by now?     | Constant-velocity extrapolation of its box (`predictBox`), per millisecond of real elapsed time      |
| Score   | How well does a detection fit a track? | The stronger of predicted-box IoU and a center-distance term scaled by box size (`pairScore`)        |
| Gate    | When is a match good enough to accept? | The full threshold within one floor-cadence scan, relaxing linearly to a floor by the pacing cap     |
| Assign  | Who wins when candidates compete?      | Every track/detection pair scored up front, then claimed from the strongest pair down                |

Matching never crosses classes: a track's id claims the same object is still there, and an object does not change class. Two constraints hold across the slots. Velocity and the gate are functions of real elapsed milliseconds, never of result counts, because scans arrive anywhere between the pacing floor and cap and anything counted per result would mean a different physical speed at every cadence. And the whole matcher stays pure math over a handful of boxes once per scan, so it costs nothing thermally and tests directly.

The slots are also why future work composes instead of competing: each upgrade below replaces one answer and leaves the rest standing.

## Later, only on evidence from real drives

**Appearance tiebreaker.** When two same-class candidates are geometrically ambiguous, two cars side by side, a coarse color signature per detection (a small downsample of the box crop) can break the tie as one more term in the pair score. It needs a new field through the worker protocol, so it is its own change, and it waits until drives with the geometric matcher still show swaps.

**Ground-plane prediction.** `scenePlacement` already projects boxes to ground coordinates through a pinhole model. Vehicle motion is far more linear there than in image space, where an approaching car's box grows nonlinearly, so predicting in ground coordinates and reprojecting would make the constant-velocity assumption more honest. This replaces the Predict slot's coordinate space; the other slots carry over unchanged. The open problem is ego-motion, since the phone has no speed input, so this waits until the image-space version proves too crude.

## Off the table

Anything that adds work between scans: optical flow, template tracking, or a re-identification network. The scan cadence exists to keep a dash-mounted phone inside its thermal budget, and identity is a presentation concern; it does not get to spend inference-scale watts.
