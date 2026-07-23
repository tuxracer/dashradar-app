import { isNumber, isPlainObject, isString } from "remeda";

/**
 * Persisted crash streak backing the WASM safe mode: how many consecutive
 * WebGPU crashes the current release has seen. Safe mode is armed once
 * `crashes` reaches SAFE_MODE_CRASH_THRESHOLD.
 */
export type SafeModeRecord = {
  release: string;
  crashes: number;
};

/** Validates a parsed localStorage blob as a SafeModeRecord. */
export const isSafeModeRecord = (value: unknown): value is SafeModeRecord => {
  return (
    isPlainObject(value) && isString(value.release) && isNumber(value.crashes)
  );
};
