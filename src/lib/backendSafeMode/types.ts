import { isPlainObject, isString } from "remeda";

/** Persisted shape of an armed safe mode: the release it was armed under. */
export type SafeModeRecord = {
  release: string;
};

/** Validates a parsed localStorage blob as a SafeModeRecord. */
export const isSafeModeRecord = (value: unknown): value is SafeModeRecord => {
  return isPlainObject(value) && isString(value.release);
};
