/** localStorage key holding the WebGPU crash streak / armed safe-mode record. */
export const SAFE_MODE_STORAGE_KEY = "dashradar:backendSafeMode";

/**
 * Consecutive WebGPU crashes required before the WASM safe mode arms. A
 * single classification is too weak a signal to downgrade a device for a
 * whole release: a first visit can crash once on a transient memory spike
 * (model download, session compile, and camera all racing), and a false
 * "crash" read (for example a live heartbeat consumed by a second tab)
 * should never pin a healthy GPU to the CPU path on its own.
 */
export const SAFE_MODE_CRASH_THRESHOLD = 2;
