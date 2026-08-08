/**
 * Measures the wasm heap onnxruntime-web runs on, for the crash sentinel: an iOS
 * memory kill runs no JS, so the size at death is only knowable if written down.
 *
 * ORT offers no accessor, but its Emscripten runtime creates the heap here with
 * `new WebAssembly.Memory(...)`, so a recording subclass installed before the
 * runtime initializes captures the instance. It only remembers; the instances
 * behave identically.
 */

const captured: WebAssembly.Memory[] = [];

let installed = false;

/**
 * Must run before onnxruntime-web instantiates its runtime. A failed patch
 * degrades to `wasmHeapBytes()` reporting nothing rather than breaking anything.
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
    // lib.dom types WebAssembly as a namespace, which TS will not assign
    // through; the runtime object underneath is an ordinary mutable global.
    (WebAssembly as { Memory: typeof WebAssembly.Memory }).Memory =
      CapturingMemory;
    installed = true;
  } catch {
    // A platform refusing the patch loses the measurement, nothing else.
  }
};

/**
 * Current size of the largest memory created since the capture was installed.
 * The largest rather than a sum, because the runtime also creates throwaway
 * zero-page memories probing for feature support.
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
