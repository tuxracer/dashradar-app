/**
 * Master output gain for the beeper. Kept modest because a square wave is
 * harsh; loud enough to hear over road noise on a dash mount without clipping.
 */
export const MASTER_GAIN = 0.13;

/** Oscillator waveform. Square gives the raspy, attention-grabbing detector tone. */
export const BEEP_WAVEFORM: OscillatorType = "square";

/** Length of one discrete beep, in ms. Kept below INTERVAL_MIN_MS so a gap remains. */
export const BEEP_DURATION_MS = 70;

/** Gain attack ramp, in seconds. Short, to avoid a click without a slow fade-in. */
export const ATTACK_SEC = 0.005;

/** Gain release ramp, in seconds. Must stay below BEEP_DURATION_MS. */
export const RELEASE_SEC = 0.03;

/**
 * Signal level at or below which the beeper is silent. Just above zero so a
 * near-zero signal reads as silence rather than sporadic beeps. Must stay at
 * or above RadarDetectorScreen's CONTACT_THRESHOLD: the dial's level is never
 * below the raw signal the beeper is fed, so this ordering guarantees a beep
 * never sounds while the dial still reads SCANNING.
 */
export const AUDIO_FLOOR = 0.02;

/** Gap between beeps at the weakest audible signal, in ms (slowest cadence). */
export const INTERVAL_MAX_MS = 900;

/** Gap between beeps at full signal, in ms (fastest cadence, still pulsing). */
export const INTERVAL_MIN_MS = 130;

/**
 * How long the beeper stays silent before its AudioContext is suspended, in ms.
 *
 * A running context keeps the audio render thread and the device's audio
 * hardware out of their idle states for as long as it exists, and the beeper's
 * context is created on the first alert of a drive and would otherwise stay
 * running for every quiet hour after it. Suspending gives that power back and
 * costs only that the first beep after a long silence waits for the resume,
 * which is a few milliseconds and lands well inside one beep interval.
 *
 * Generous on purpose. Scanning alternates between contacts often enough that a
 * short timeout would cycle the context constantly for no further saving.
 */
export const IDLE_SUSPEND_MS = 10_000;

/**
 * Beep pitch, in Hz. Fixed across all signal levels: only the cadence
 * (beepIntervalMs) speeds up with the signal, never the tone. A sweeping pitch
 * reads as an annoying whine, so the tone stays constant and the rate carries
 * the confidence. High enough to cut through road noise on a dash mount.
 */
export const BEEP_FREQ_HZ = 800;
