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
 * Signal level at or below which the beeper is silent, just above zero so noise
 * does not beep. Must stay at or above CONTACT_THRESHOLD, or a beep can sound
 * while the dial still reads SCANNING.
 */
export const AUDIO_FLOOR = 0.02;

/** Gap between beeps at the weakest audible signal, in ms (slowest cadence). */
export const INTERVAL_MAX_MS = 900;

/** Gap between beeps at full signal, in ms (fastest cadence, still pulsing). */
export const INTERVAL_MIN_MS = 130;

/**
 * How long the beeper stays silent before its AudioContext is suspended. A
 * running context keeps the audio thread and hardware out of idle, so one alert
 * early in a drive would otherwise cost every quiet hour after it. Generous on
 * purpose: a short timeout would cycle the context constantly for no saving.
 */
export const IDLE_SUSPEND_MS = 10_000;

/**
 * Beep pitch, fixed across all levels: only the cadence speeds up with the
 * signal. A sweeping pitch reads as a whine. High enough to cut road noise.
 */
export const BEEP_FREQ_HZ = 800;
