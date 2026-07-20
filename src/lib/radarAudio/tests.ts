import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beepFrequencyHz,
  beepIntervalMs,
  createRadarBeeper,
  isAudible,
  AUDIO_FLOOR,
  BEEP_DURATION_MS,
  FREQ_HIGH_HZ,
  FREQ_LOW_HZ,
  INTERVAL_MAX_MS,
  INTERVAL_MIN_MS,
  MASTER_GAIN,
} from "@/lib/radarAudio";

class FakeAudioParam {
  value = 0;
  setValueAtTime = vi.fn();
  linearRampToValueAtTime = vi.fn();
  cancelScheduledValues = vi.fn();
}

class FakeOscillator {
  type: OscillatorType = "sine";
  frequency = new FakeAudioParam();
  connect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class FakeGainNode {
  gain = new FakeAudioParam();
  connect = vi.fn();
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  static initialState: AudioContextState = "running";
  /** Mirrors autoplay policy: resume() only takes effect once allowed. */
  static resumeAllowed = true;
  state: AudioContextState = FakeAudioContext.initialState;
  currentTime = 0;
  destination = {};
  oscillator = new FakeOscillator();
  gainNode = new FakeGainNode();
  resume = vi.fn(async () => {
    if (FakeAudioContext.resumeAllowed) {
      this.state = "running";
    }
  });
  close = vi.fn(async () => {});
  constructor() {
    FakeAudioContext.instances.push(this);
  }
  createOscillator() {
    return this.oscillator;
  }
  createGain() {
    return this.gainNode;
  }
}

beforeEach(() => {
  FakeAudioContext.instances = [];
  FakeAudioContext.initialState = "running";
  FakeAudioContext.resumeAllowed = true;
  vi.stubGlobal("AudioContext", FakeAudioContext);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const audioContext = (): FakeAudioContext => {
  const context = FakeAudioContext.instances[0];
  if (!context) {
    throw new Error("no AudioContext was created");
  }
  return context;
};

describe("beepIntervalMs", () => {
  it("beeps slowest at the audible floor", () => {
    expect(beepIntervalMs(AUDIO_FLOOR)).toBe(INTERVAL_MAX_MS);
  });

  it("beeps fastest at full signal, still leaving a gap between beeps", () => {
    expect(beepIntervalMs(1)).toBe(INTERVAL_MIN_MS);
    expect(INTERVAL_MIN_MS).toBeGreaterThan(BEEP_DURATION_MS);
  });

  it("speeds up as the signal climbs", () => {
    expect(beepIntervalMs(0.6)).toBeLessThan(beepIntervalMs(0.3));
  });
});

describe("beepFrequencyHz", () => {
  it("spans the low and high pitches across the signal range", () => {
    expect(beepFrequencyHz(0)).toBe(FREQ_LOW_HZ);
    expect(beepFrequencyHz(1)).toBe(FREQ_HIGH_HZ);
  });

  it("rises with the signal", () => {
    expect(beepFrequencyHz(0.8)).toBeGreaterThan(beepFrequencyHz(0.2));
  });
});

describe("isAudible", () => {
  it("is silent at or below the audio floor", () => {
    expect(isAudible(AUDIO_FLOOR)).toBe(false);
    expect(isAudible(AUDIO_FLOOR + 0.001)).toBe(true);
  });
});

describe("createRadarBeeper", () => {
  it("creates no AudioContext while the signal is inaudible", () => {
    const beeper = createRadarBeeper();
    beeper.update(0, 0);
    beeper.update(AUDIO_FLOOR, 100);
    expect(FakeAudioContext.instances).toHaveLength(0);
    beeper.dispose();
  });

  it("builds the audio graph and beeps on the first audible update", () => {
    const beeper = createRadarBeeper();
    beeper.update(0.5, 1_000);
    const context = audioContext();
    expect(context.oscillator.start).toHaveBeenCalledOnce();
    expect(context.oscillator.frequency.setValueAtTime).toHaveBeenCalledWith(
      beepFrequencyHz(0.5),
      context.currentTime,
    );
    expect(context.gainNode.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      MASTER_GAIN,
      expect.any(Number),
    );
    beeper.dispose();
  });

  it("schedules every beep as a self-terminating envelope, never a held tone", () => {
    const beeper = createRadarBeeper();
    beeper.update(1, 1_000);
    const gain = audioContext().gainNode.gain;
    // Even at full signal the beep ramps up and back to zero.
    expect(gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      MASTER_GAIN,
      expect.any(Number),
    );
    expect(gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(
      0,
      expect.any(Number),
    );
    beeper.dispose();
  });

  it("waits out the beep interval before beeping again", () => {
    const beeper = createRadarBeeper();
    beeper.update(0.5, 1_000);
    const beepCalls = () =>
      audioContext().gainNode.gain.linearRampToValueAtTime.mock.calls.length;
    const afterFirst = beepCalls();
    beeper.update(0.5, 1_000 + beepIntervalMs(0.5) - 1);
    expect(beepCalls()).toBe(afterFirst);
    beeper.update(0.5, 1_000 + beepIntervalMs(0.5) + 1);
    expect(beepCalls()).toBeGreaterThan(afterFirst);
    beeper.dispose();
  });

  it("beeps immediately when a fresh contact follows silence", () => {
    const beeper = createRadarBeeper();
    beeper.update(0.5, 1_000);
    const beepCalls = () =>
      audioContext().gainNode.gain.linearRampToValueAtTime.mock.calls.length;
    const afterFirst = beepCalls();
    // The signal clears, then a new contact appears one frame later: no
    // leftover interval should delay the first beep of the new contact.
    beeper.update(0, 1_016);
    beeper.update(0.5, 1_032);
    expect(beepCalls()).toBeGreaterThan(afterFirst);
    beeper.dispose();
  });

  it("resumes a suspended context on the next user gesture", () => {
    FakeAudioContext.initialState = "suspended";
    FakeAudioContext.resumeAllowed = false;
    const beeper = createRadarBeeper();
    beeper.update(0.5, 1_000);
    const context = audioContext();
    // Creation attempts one resume; while suspended, nothing is scheduled.
    expect(context.resume).toHaveBeenCalledOnce();
    expect(
      context.gainNode.gain.linearRampToValueAtTime,
    ).not.toHaveBeenCalled();
    // The user gesture arrives and autoplay policy now permits the resume.
    FakeAudioContext.resumeAllowed = true;
    window.dispatchEvent(new Event("pointerdown"));
    expect(context.resume).toHaveBeenCalledTimes(2);
    beeper.update(0.5, 2_000);
    expect(context.gainNode.gain.linearRampToValueAtTime).toHaveBeenCalled();
    beeper.dispose();
  });

  it("stops the oscillator and closes the context on dispose", () => {
    const beeper = createRadarBeeper();
    beeper.update(0.5, 1_000);
    beeper.dispose();
    const context = audioContext();
    expect(context.oscillator.stop).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
  });

  it("no-ops without Web Audio support", () => {
    vi.unstubAllGlobals();
    const beeper = createRadarBeeper();
    expect(() => {
      beeper.update(0.9, 1_000);
      beeper.dispose();
    }).not.toThrow();
  });
});
