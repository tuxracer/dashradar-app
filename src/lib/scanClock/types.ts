/**
 * The pump's scanning clock. Named so consumers can hold one in a ref without
 * restating the factory's shape.
 */
export type ScanClock = {
  start: () => void;
  stop: () => void;
  takeUnreportedMs: (minimumMs?: number) => number;
};
