import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beepFrequencyHz,
  beepIntervalMs,
  createRadarBeeper,
  isAudible,
  isSolidTone,
  AUDIO_FLOOR,
  FREQ_HIGH_HZ,
  FREQ_LOW_HZ,
  INTERVAL_MAX_MS,
  INTERVAL_MIN_MS,
  MASTER_GAIN,
  SOLID_THRESHOLD,
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

  it("beeps fastest at the solid-tone threshold", () => {
    expect(beepIntervalMs(SOLID_THRESHOLD)).toBe(INTERVAL_MIN_MS);
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

describe("isAudible / isSolidTone", () => {
  it("is silent at or below the audio floor", () => {
    expect(isAudible(AUDIO_FLOOR)).toBe(false);
    expect(isAudible(AUDIO_FLOOR + 0.001)).toBe(true);
  });

  it("goes solid only at the solid threshold", () => {
    expect(isSolidTone(SOLID_THRESHOLD - 0.001)).toBe(false);
    expect(isSolidTone(SOLID_THRESHOLD)).toBe(true);
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

  it("holds one continuous tone at the solid threshold", () => {
    const beeper = createRadarBeeper();
    beeper.update(0.9, 1_000);
    const gain = audioContext().gainNode.gain;
    // Solid engage ramps up once and schedules no release back to zero.
    expect(gain.linearRampToValueAtTime).toHaveBeenCalledTimes(1);
    expect(gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      MASTER_GAIN,
      expect.any(Number),
    );
    // Staying solid re-tunes the pitch but does not re-trigger the envelope.
    beeper.update(0.95, 1_016);
    expect(gain.linearRampToValueAtTime).toHaveBeenCalledTimes(1);
    beeper.dispose();
  });

  it("silences when the signal drops away after a solid tone", () => {
    const beeper = createRadarBeeper();
    beeper.update(0.9, 1_000);
    beeper.update(0, 1_016);
    const gain = audioContext().gainNode.gain;
    expect(gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(
      0,
      expect.any(Number),
    );
    beeper.dispose();
  });

  it("silences a solid tone when the page is hidden", () => {
    const beeper = createRadarBeeper();
    beeper.update(0.9, 1_000);
    const gain = audioContext().gainNode.gain;
    const rampCallsBefore = gain.linearRampToValueAtTime.mock.calls.length;
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(gain.linearRampToValueAtTime.mock.calls.length).toBeGreaterThan(
      rampCallsBefore,
    );
    expect(gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(
      0,
      expect.any(Number),
    );
    visibility.mockRestore();
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
