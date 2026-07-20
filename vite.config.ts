import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { Plugin } from "vite";

// Headers that make the page cross-origin isolated. Without these,
// SharedArrayBuffer is unavailable and onnxruntime-web runs its WASM backend
// single-threaded, which is the difference between ~1 and several inference
// threads on the many mobile devices that have no usable WebGPU. Applied to dev,
// preview, and (via vercel.json) production. `require-corp` works on every
// browser including Safari; the only cross-origin runtime fetch is the Hugging
// Face model, which is a CORS request and so passes the check. The ONNX runtime
// wasm is served same-origin from /ort/ (see ortRuntime below) rather than the
// jsdelivr CDN precisely so it does not need cross-origin exemption.
const CROSS_ORIGIN_ISOLATION_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

/**
 * onnxruntime-web's bundle build fetches these two files at runtime (the wasm
 * binary and its ES-module glue, including the code its thread workers load).
 * We serve them same-origin from /ort/ instead of letting the runtime pull them
 * from cdn.jsdelivr.net, so cross-origin isolation does not block them and the
 * app keeps no live CDN dependency.
 */
const ORT_RUNTIME_FILES = [
  "ort-wasm-simd-threaded.jsep.wasm",
  "ort-wasm-simd-threaded.jsep.mjs",
] as const;

/** Absolute path to one of onnxruntime-web's shipped runtime files. */
const ortRuntimePath = (file: string): URL =>
  new URL(`./node_modules/onnxruntime-web/dist/${file}`, import.meta.url);

/**
 * Serve onnxruntime-web's wasm/mjs runtime from /ort/ in both dev and the build
 * output, copied straight from the installed package (never committed to the
 * repo). The worker points env.wasm.wasmPaths at /ort/ so the runtime and its
 * thread workers load same-origin.
 */
const ortRuntime = (): Plugin => ({
  name: "ort-runtime",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      // Match on the pathname alone: Vite's import analysis appends ?import to
      // dynamic imports of the .mjs, which must not fall through to the SPA
      // index.html fallback.
      const [pathname] = (req.url ?? "").split("?");
      const file = ORT_RUNTIME_FILES.find(
        (name) => pathname === `/ort/${name}`,
      );
      if (!file) {
        next();
        return;
      }
      res.setHeader(
        "Content-Type",
        file.endsWith(".wasm") ? "application/wasm" : "text/javascript",
      );
      res.end(readFileSync(ortRuntimePath(file)));
    });
  },
  generateBundle(_options, bundle) {
    // onnxruntime-web's bundle references the wasm via `new URL(..., import.meta
    // .url)`, so Vite also emits a hashed copy into assets/. wasmPaths points at
    // our /ort/ copy instead, leaving that one unfetched, so drop it rather than
    // ship ~27 MB of dead weight.
    for (const fileName of Object.keys(bundle)) {
      if (
        fileName.includes("ort-wasm-simd-threaded") &&
        !fileName.startsWith("ort/")
      ) {
        delete bundle[fileName];
      }
    }
    for (const file of ORT_RUNTIME_FILES) {
      this.emitFile({
        type: "asset",
        fileName: `ort/${file}`,
        source: readFileSync(ortRuntimePath(file)),
      });
    }
  },
});

const resolveCommitSha = (): string => {
  // Vercel injects this at build time; prefer it so the SHA matches the deployed commit.
  if (process.env.VERCEL_GIT_COMMIT_SHA) {
    return process.env.VERCEL_GIT_COMMIT_SHA;
  }
  try {
    return execFileSync("git", ["rev-parse", "HEAD"]).toString().trim();
  } catch {
    return "unknown";
  }
};

/** Full commit SHA for this build (Vercel env or local git), or "unknown". */
const COMMIT_SHA: string = resolveCommitSha();

/** Short (7-char) commit SHA shown alongside the app version in settings. */
const SHORT_COMMIT_SHA: string =
  COMMIT_SHA === "unknown" ? "unknown" : COMMIT_SHA.slice(0, 7);

const commitShaMeta = (): Plugin => ({
  name: "commit-sha-meta",
  transformIndexHtml: (html) =>
    html.replace(
      "</head>",
      `  <meta name="version" content="${COMMIT_SHA}" />\n  </head>`,
    ),
});

// Generous ceiling for the JS/CSS bundle. The onnxruntime-web .wasm runtime is
// excluded from globPatterns below (the glob omits wasm/mjs): it is served from
// /ort/ by the ortRuntime plugin and cached on demand by the "ort-runtime"
// CacheFirst route instead of precached, matching how the model weights load
// (fetched on first use, then available offline) rather than front-loading
// ~27 MB into the service-worker install.
const PRECACHE_MAX_FILE_SIZE = 40_000_000;

const pwa = () =>
  VitePWA({
    registerType: "autoUpdate",
    manifest: {
      name: "dashradar",
      short_name: "dashradar",
      description:
        "Turn your phone into a dashcam with live on-device object detection. Runs entirely in the browser, works offline, and no data leaves your device.",
      display: "standalone",
      start_url: "/",
      background_color: "#0B0A10",
      theme_color: "#0B0A10",
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        {
          src: "/icon-maskable-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable",
        },
      ],
    },
    workbox: {
      globPatterns: ["**/*.{js,css,html,svg,png,woff,woff2}"],
      maximumFileSizeToCacheInBytes: PRECACHE_MAX_FILE_SIZE,
      runtimeCaching: [
        {
          // The onnxruntime-web wasm/mjs runtime, served same-origin from /ort/
          // by the ortRuntime plugin; cache-first so the app cold-loads offline
          // after the first run without precaching ~27 MB up front.
          urlPattern: ({ url, sameOrigin }) =>
            sameOrigin && url.pathname.startsWith("/ort/"),
          handler: "CacheFirst",
          options: {
            cacheName: "ort-runtime",
            expiration: { maxEntries: 8 },
            cacheableResponse: { statuses: [0, 200] },
          },
        },
        {
          // The RF-DETR ONNX weights are downloaded from Hugging Face at
          // runtime; cache-first so the model survives offline cold-loads.
          urlPattern: ({ url }) => url.hostname === "huggingface.co",
          handler: "CacheFirst",
          options: {
            cacheName: "model-cache",
            expiration: { maxEntries: 4 },
            cacheableResponse: { statuses: [0, 200] },
          },
        },
      ],
    },
  });

/** App version read from package.json, injected into the bundle as __APP_VERSION__. */
const APP_VERSION: string = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
).version;

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __COMMIT_SHA__: JSON.stringify(SHORT_COMMIT_SHA),
  },
  plugins: [react(), tailwindcss(), commitShaMeta(), ortRuntime(), pwa()],
  resolve: { tsconfigPaths: true },
  server: { headers: CROSS_ORIGIN_ISOLATION_HEADERS },
  preview: { headers: CROSS_ORIGIN_ISOLATION_HEADERS },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.{test,spec}.?(c|m)[jt]s?(x)", "**/tests.[jt]s?(x)"],
  },
});
