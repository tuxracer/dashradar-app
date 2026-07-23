import { SAFE_MODE_RELEASE, SAFE_MODE_STORAGE_KEY } from "./consts";
import { isSafeModeRecord } from "./types";

export * from "./consts";
export * from "./types";

/**
 * Arm the WASM safe mode: the next sessions of this release run detection on
 * the CPU (wasm) backend instead of WebGPU. Armed by src/instrument.ts when
 * the crash sentinel classifies the previous session as a crash that happened
 * on WebGPU, on the theory that the GPU path took the page down. Sticky for
 * the current release only (see SAFE_MODE_RELEASE): a one-shot flag would
 * oscillate between a WebGPU crash and a clean WASM session on every other
 * launch, while a version-keyed one holds WASM until a build that may fix the
 * crash ships. Best-effort: a localStorage failure leaves safe mode unarmed.
 */
export const armWasmSafeMode = (): void => {
  try {
    window.localStorage.setItem(
      SAFE_MODE_STORAGE_KEY,
      JSON.stringify({ release: SAFE_MODE_RELEASE }),
    );
  } catch {
    // Private mode or quota pressure; run without safe mode.
  }
};

/**
 * Whether the WASM safe mode is armed for the current release. Not consumed
 * by reading: the record stays until a new release disarms it (or storage is
 * cleared). A record from a different release, or an invalid blob, is removed
 * and reads as unarmed, so each deploy retries WebGPU once.
 */
export const isWasmSafeModeArmed = (): boolean => {
  try {
    const raw = window.localStorage.getItem(SAFE_MODE_STORAGE_KEY);
    if (raw === null) {
      return false;
    }
    const record: unknown = JSON.parse(raw);
    if (!isSafeModeRecord(record) || record.release !== SAFE_MODE_RELEASE) {
      window.localStorage.removeItem(SAFE_MODE_STORAGE_KEY);
      return false;
    }
    return true;
  } catch {
    // Unreadable storage or corrupt JSON: treat as unarmed and best-effort
    // clear so the same blob does not throw on every launch.
    try {
      window.localStorage.removeItem(SAFE_MODE_STORAGE_KEY);
    } catch {
      // Storage entirely unavailable; nothing to clean up.
    }
    return false;
  }
};
