import {
  ATTACK_SEC,
  AUDIO_FLOOR,
  BEEP_DURATION_MS,
  BEEP_FREQ_HZ,
  BEEP_WAVEFORM,
  IDLE_SUSPEND_MS,
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
 * Creates the radar-detector beeper: discrete beeps whose cadence rises with
 * the signal level at a fixed pitch, and silence when there is no signal. Each
 * beep is a short self-terminating envelope, so there is never a sustained tone.
 *
 * The AudioContext and a single persistent oscillator are created lazily on the
 * first audible update, so a muted or signal-free session never touches Web
 * Audio. Browsers keep a context created outside a user gesture suspended;
 * a one-shot gesture listener resumes it, so at worst the first beeps of a
 * session are dropped until the user has touched the page once. Graceful no-op
 * when Web Audio is unavailable.
 *
 * Once built, the context is suspended again after IDLE_SUSPEND_MS of silence
 * and resumed on the next contact. Without that, one alert early in a drive
 * would leave the audio thread running for every quiet hour after it, which on
 * a dash-mounted phone is hours of power spent on nothing.
 */
export const createRadarBeeper = (): RadarBeeper => {
  let nodes: BeeperNodes | undefined;
  let disposed = false;
  // Monotonic-clock time the next beep may start. 0 means "beep immediately",
  // so the first contact after silence sounds without waiting out an interval.
  let nextBeepAtMs = 0;
  // Pending idle-suspend timer, armed while the signal is inaudible.
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  // Whether the suspension in effect is ours rather than the browser's. Only a
  // context we suspended may be resumed without a user gesture: resuming one
  // the autoplay policy is holding down is rejected, and the beeper is fed
  // every animation frame, so guessing wrong means a rejected promise per
  // frame. The gesture listeners in ensureNodes own that other case.
  let idleSuspended = false;

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

  /** Suspend an idle context, releasing the audio thread until the next beep. */
  const suspendWhenIdle = () => {
    idleTimer = undefined;
    if (disposed || !nodes || nodes.context.state !== "running") {
      return;
    }
    idleSuspended = true;
    void nodes.context.suspend();
  };

  const armIdleSuspend = () => {
    // Nothing to suspend until the first audible signal builds the graph, and
    // an already-armed timer must keep its original deadline rather than being
    // pushed out by every frame of continuing silence.
    if (idleTimer !== undefined || !nodes) {
      return;
    }
    idleTimer = setTimeout(suspendWhenIdle, IDLE_SUSPEND_MS);
  };

  const cancelIdleSuspend = () => {
    if (idleTimer !== undefined) {
      clearTimeout(idleTimer);
      idleTimer = undefined;
    }
  };

  const update = (level: number, nowMs: number) => {
    if (disposed) {
      return;
    }
    if (!isAudible(level)) {
      nextBeepAtMs = 0;
      armIdleSuspend();
      return;
    }
    cancelIdleSuspend();
    const active = ensureNodes();
    if (!active) {
      return;
    }
    if (idleSuspended) {
      // Resuming is asynchronous, so this frame stays silent and the next one
      // finds a running context. nextBeepAtMs is already 0 from the silence
      // that led here, so the beep lands on that frame rather than waiting out
      // an interval.
      idleSuspended = false;
      void active.context.resume();
      return;
    }
    if (active.context.state !== "running") {
      return;
    }
    if (nowMs < nextBeepAtMs) {
      return;
    }
    nextBeepAtMs = nowMs + beepIntervalMs(level);
    const { context, oscillator, gain } = active;
    const now = context.currentTime;
    oscillator.frequency.setValueAtTime(BEEP_FREQ_HZ, now);
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
    cancelIdleSuspend();
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
