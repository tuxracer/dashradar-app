import { APP_RELEASE } from "@/lib/appRelease";
import type { PreviousSessionEnd } from "@/lib/crashSentinel";
import { SAFE_MODE_CRASH_THRESHOLD, SAFE_MODE_STORAGE_KEY } from "./consts";
import { isSafeModeRecord } from "./types";
import type { SafeModeRecord } from "./types";

export * from "./consts";
export * from "./types";

/**
 * Read the stored crash-streak record for the current release. A record from
 * a different release, or an invalid blob, is removed and reads as absent, so
 * each deploy starts from a clean streak and retries WebGPU. Best-effort: any
 * storage failure reads as absent.
 */
const readRecord = (): SafeModeRecord | undefined => {
  try {
    const raw = window.localStorage.getItem(SAFE_MODE_STORAGE_KEY);
    if (raw === null) {
      return undefined;
    }
    const record: unknown = JSON.parse(raw);
    if (!isSafeModeRecord(record) || record.release !== APP_RELEASE) {
      window.localStorage.removeItem(SAFE_MODE_STORAGE_KEY);
      return undefined;
    }
    return record;
  } catch {
    // Unreadable storage or corrupt JSON: treat as absent and best-effort
    // clear so the same blob does not throw on every launch.
    try {
      window.localStorage.removeItem(SAFE_MODE_STORAGE_KEY);
    } catch {
      // Storage entirely unavailable; nothing to clean up.
    }
    return undefined;
  }
};

/**
 * Whether a previous session's dirty end should count toward the WASM safe
 * mode: a crash-classified end, on the WebGPU backend, whose sentinel record
 * was written by this same build. The release match is what makes "every new
 * deploy retries WebGPU once" true: a record left behind by an older build
 * (whose crash the new build may well have fixed, or which a pre-pagehide-fix
 * build orphaned on a plain reload) never counts against the new build.
 */
export const shouldCountWebGpuCrash = (
  end: PreviousSessionEnd | undefined,
): boolean => {
  return (
    end?.outcome === "crash" &&
    end.backend === "webgpu" &&
    end.release === APP_RELEASE
  );
};

/**
 * Record one WebGPU crash against the current release's streak. Called by
 * src/instrument.ts when the crash sentinel classifies the previous session
 * as a same-release WebGPU crash. Arming is implicit: once the streak reaches
 * SAFE_MODE_CRASH_THRESHOLD, isWasmSafeModeArmed reads true and this
 * release's remaining sessions run detection on the CPU (wasm) backend. The
 * threshold plus the clean-end reset (resetWebGpuCrashStreak) means only
 * back-to-back crashes arm it, while an armed record is sticky for the
 * release: a one-shot flag would oscillate between a WebGPU crash and a
 * clean WASM session on every other launch. Best-effort: a localStorage
 * failure leaves the streak unchanged.
 */
export const recordWebGpuCrash = (): void => {
  const crashes = (readRecord()?.crashes ?? 0) + 1;
  try {
    window.localStorage.setItem(
      SAFE_MODE_STORAGE_KEY,
      JSON.stringify({ release: APP_RELEASE, crashes }),
    );
  } catch {
    // Private mode or quota pressure; run without safe mode.
  }
};

/**
 * Reset a below-threshold crash streak after a scanning session ends
 * cleanly: a clean end proves the backend did not take the page down, so an
 * earlier isolated crash stops counting toward safe mode. An armed record
 * (streak at the threshold) is deliberately kept: once armed the sessions
 * run WASM, so their clean ends say nothing about WebGPU and must not
 * disarm it before the next release retries.
 */
export const resetWebGpuCrashStreak = (): void => {
  const record = readRecord();
  if (!record || record.crashes >= SAFE_MODE_CRASH_THRESHOLD) {
    return;
  }
  try {
    window.localStorage.removeItem(SAFE_MODE_STORAGE_KEY);
  } catch {
    // Storage unavailable; nothing to clear.
  }
};

/**
 * Whether the WASM safe mode is armed for the current release: the crash
 * streak has reached SAFE_MODE_CRASH_THRESHOLD. Not consumed by reading; the
 * record stays until a new release discards it (or storage is cleared), so
 * each deploy retries WebGPU once.
 */
export const isWasmSafeModeArmed = (): boolean => {
  const record = readRecord();
  return record !== undefined && record.crashes >= SAFE_MODE_CRASH_THRESHOLD;
};
