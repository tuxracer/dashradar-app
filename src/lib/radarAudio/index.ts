import {
  ATTACK_SEC,
  AUDIO_FLOOR,
  BEEP_DURATION_MS,
  BEEP_WAVEFORM,
  FREQ_HIGH_HZ,
  FREQ_LOW_HZ,
  INTERVAL_MAX_MS,
  INTERVAL_MIN_MS,
  MASTER_GAIN,
  RELEASE_SEC,
} from "./consts";

export * from "./consts";

/** Clamp a number into the inclusive [0, 1] range. */
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** Linear interpolation between a and b by t in [0, 1]. */
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Whether a signal level produces any sound at all. */
export const isAudible = (level: number): boolean => level > AUDIO_FLOOR;

/**
 * Gap between beep starts for a signal level, in ms. The audible band
 * [AUDIO_FLOOR, 1] maps onto [INTERVAL_MAX_MS, INTERVAL_MIN_MS]: the beeps
 * pulse faster as confidence climbs but never merge into a continuous tone.
 */
export const beepIntervalMs = (level: number): number => {
  const t = clamp01((level - AUDIO_FLOOR) / (1 - AUDIO_FLOOR));
  return lerp(INTERVAL_MAX_MS, INTERVAL_MIN_MS, t);
};

/** Beep pitch for a signal level in [0, 1], rising with the signal. */
export const beepFrequencyHz = (level: number): number =>
  lerp(FREQ_LOW_HZ, FREQ_HIGH_HZ, clamp01(level));

/** Radar-detector beeper driven once per animation frame via update(). */
export type RadarBeeper = {
  /**
   * Feed the current signal level. `nowMs` is the caller's monotonic clock (the
   * requestAnimationFrame timestamp), used only to pace the beep cadence.
   */
  update: (level: number, nowMs: number) => void;
  /** Silence and tear down the audio graph. The beeper is unusable after. */
  dispose: () => void;
};

type BeeperNodes = {
  context: AudioContext;
  oscillator: OscillatorNode;
  gain: GainNode;
};

/** Gestures that satisfy autoplay policy, used to unlock a suspended context. */
const UNLOCK_EVENTS = ["pointerdown", "touchend", "keydown"] as const;

/**
 * Creates the radar-detector beeper: discrete beeps whose cadence and pitch
 * rise with the signal level, and silence when there is no signal. Each beep is
 * a short self-terminating envelope, so there is never a sustained tone.
 *
 * The AudioContext and a single persistent oscillator are created lazily on the
 * first audible update, so a muted or signal-free session never touches Web
 * Audio. Browsers keep a context created outside a user gesture suspended;
 * a one-shot gesture listener resumes it, so at worst the first beeps of a
 * session are dropped until the user has touched the page once. Graceful no-op
 * when Web Audio is unavailable.
 */
export const createRadarBeeper = (): RadarBeeper => {
  let nodes: BeeperNodes | undefined;
  let disposed = false;
  // Monotonic-clock time the next beep may start. 0 means "beep immediately",
  // so the first contact after silence sounds without waiting out an interval.
  let nextBeepAtMs = 0;

  const handleUnlock = () => {
    // Called from a user gesture, where resume() is permitted to succeed.
    void nodes?.context.resume();
    for (const eventName of UNLOCK_EVENTS) {
      window.removeEventListener(eventName, handleUnlock);
    }
  };

  const removeUnlockListeners = () => {
    for (const eventName of UNLOCK_EVENTS) {
      window.removeEventListener(eventName, handleUnlock);
    }
  };

  const ensureNodes = (): BeeperNodes | undefined => {
    if (nodes || disposed || typeof AudioContext === "undefined") {
      return nodes;
    }
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = BEEP_WAVEFORM;
    gain.gain.value = 0;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    nodes = { context, oscillator, gain };
    if (context.state === "suspended") {
      // Try immediately in case a gesture already happened this session, and
      // fall back to unlocking on the next one.
      void context.resume();
      for (const eventName of UNLOCK_EVENTS) {
        window.addEventListener(eventName, handleUnlock);
      }
    }
    return nodes;
  };

  const update = (level: number, nowMs: number) => {
    if (disposed) {
      return;
    }
    if (!isAudible(level)) {
      nextBeepAtMs = 0;
      return;
    }
    const active = ensureNodes();
    if (!active || active.context.state !== "running") {
      return;
    }
    if (nowMs < nextBeepAtMs) {
      return;
    }
    nextBeepAtMs = nowMs + beepIntervalMs(level);
    const { context, oscillator, gain } = active;
    const now = context.currentTime;
    oscillator.frequency.setValueAtTime(beepFrequencyHz(level), now);
    const beepEnd = now + BEEP_DURATION_MS / 1000;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(MASTER_GAIN, now + ATTACK_SEC);
    gain.gain.setValueAtTime(MASTER_GAIN, beepEnd - RELEASE_SEC);
    gain.gain.linearRampToValueAtTime(0, beepEnd);
  };

  const dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    removeUnlockListeners();
    if (nodes) {
      try {
        nodes.oscillator.stop();
      } catch {
        // Already stopped.
      }
      void nodes.context.close();
      nodes = undefined;
    }
  };

  return { update, dispose };
};
