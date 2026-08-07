/**
 * Measures the wasm heap onnxruntime-web is running on, for the crash
 * sentinel. iOS kills the page for exceeding WebContent's per-process memory
 * limit with no JS running at kill time, and WebKit exposes no memory API, so
 * the only way to know how big the runtime's heap was when a session died is
 * to have written it down while the session was alive.
 *
 * onnxruntime-web offers no public accessor for its heap, but its Emscripten
 * runtime creates the heap in this worker's scope with `new
 * WebAssembly.Memory(...)`. Replacing the constructor with a recording
 * subclass before the runtime initializes (instantiation happens on the first
 * session build, long after module evaluation) captures the instance, and
 * `memory.buffer.byteLength` then reads the heap's current committed size on
 * demand. Instances behave identically to native ones; the subclass only
 * remembers them.
 */

const captured: WebAssembly.Memory[] = [];

let installed = false;

/**
 * Replace `WebAssembly.Memory` in this worker's scope with the recording
 * subclass. Must run before onnxruntime-web instantiates its runtime; a
 * failure to patch degrades to `wasmHeapBytes()` reporting nothing rather
 * than breaking the worker.
 */
export const installWasmMemoryCapture = (): void => {
  if (installed) {
    return;
  }
  class CapturingMemory extends WebAssembly.Memory {
    constructor(descriptor: WebAssembly.MemoryDescriptor) {
      super(descriptor);
      captured.push(this);
    }
  }
  try {
    // lib.dom types WebAssembly as a namespace, whose members TS will not
    // assign through; the runtime object underneath is an ordinary mutable
    // global.
    (WebAssembly as { Memory: typeof WebAssembly.Memory }).Memory =
      CapturingMemory;
    installed = true;
  } catch {
    // A platform refusing the patch loses the measurement, nothing else.
  }
};

/**
 * Current size in bytes of the largest memory created since the capture was
 * installed, or undefined when none has been. The largest rather than a sum
 * because the runtime also creates throwaway zero-page memories probing for
 * feature support, and only the real heap answers the question this exists
 * for.
 */
export const wasmHeapBytes = (): number | undefined => {
  let largest: number | undefined;
  for (const memory of captured) {
    const bytes = memory.buffer.byteLength;
    if (largest === undefined || bytes > largest) {
      largest = bytes;
    }
  }
  return largest;
};
