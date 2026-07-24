import { describe, expect, it } from "vitest";
import { BEAT_LOOP_MS, CONTACT_APPEAR_MS, CONTACT_EXIT_MS } from "./consts";
import { contactStateAt, createIntroScene } from "./scene";

describe("createIntroScene", () => {
  it("returns null when a WebGL context cannot be created (jsdom)", () => {
    const canvas = document.createElement("canvas");
    expect(createIntroScene(canvas, 400, 800)).toBeNull();
  });
});

describe("contactStateAt", () => {
  it("has no contact during the ambient phase", () => {
    expect(contactStateAt(0).present).toBe(false);
    expect(contactStateAt(CONTACT_APPEAR_MS - 1).present).toBe(false);
    expect(contactStateAt(CONTACT_EXIT_MS + 1).present).toBe(false);
    expect(contactStateAt(BEAT_LOOP_MS - 1).present).toBe(false);
  });

  it("moves the contact from spawn depth toward the camera", () => {
    const early = contactStateAt(CONTACT_APPEAR_MS + 100);
    const late = contactStateAt(CONTACT_EXIT_MS - 100);
    if (!early.present || !late.present) throw new Error("contact missing");
    expect(early.z).toBeLessThan(late.z);
  });

  it("locks on only inside the lock depth window", () => {
    const justSpawned = contactStateAt(CONTACT_APPEAR_MS + 50);
    if (!justSpawned.present) throw new Error("contact missing");
    expect(justSpawned.lockOn).toBe(false);

    const mid = contactStateAt(6_800);
    if (!mid.present) throw new Error("contact missing");
    expect(mid.lockOn).toBe(true);
    expect(mid.sinceLockMs).toBeGreaterThan(0);
  });

  it("wraps times beyond one loop back into the loop", () => {
    const wrapped = contactStateAt(BEAT_LOOP_MS + 6_800);
    expect(wrapped.present).toBe(true);
  });
});
