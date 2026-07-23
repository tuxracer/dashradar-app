import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { execFileSync } from "node:child_process";
import {
  accessSync,
  constants as fsConstants,
  createReadStream,
  existsSync,
  readFileSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { extname, join, resolve } from "node:path";
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
 * app keeps no live CDN dependency. The asyncify pair belongs to the
 * "onnxruntime-web/webgpu" bundle the worker imports (native C++ WebGPU EP);
 * the root import would fetch the jsep pair instead, so keep these in sync
 * with the worker's import.
 */
const ORT_RUNTIME_FILES = [
  "ort-wasm-simd-threaded.asyncify.wasm",
  "ort-wasm-simd-threaded.asyncify.mjs",
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
      // Vite's server.headers don't apply to custom middleware responses, and
      // onnxruntime-web's pthread workers load the .mjs as their own script:
      // in a cross-origin-isolated page that response is blocked
      // (ERR_BLOCKED_BY_RESPONSE) unless it carries COEP itself. Blocked
      // thread workers leave InferenceSession.create waiting forever.
      for (const [name, value] of Object.entries(
        CROSS_ORIGIN_ISOLATION_HEADERS,
      )) {
        res.setHeader(name, value);
      }
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

/** Dev-server route the devVideo plugin serves the DASHRADAR_VIDEO file at. */
const DEV_VIDEO_ROUTE = "/__dev-video";

/** Content types for the video containers a browser will actually play. */
const VIDEO_CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};

/**
 * Absolute path of the dev video file named by DASHRADAR_VIDEO, or undefined
 * when the env var is unset. A set-but-unreadable path (missing, not a file,
 * or lacking read permission) fails config load, so a bad path stops the dev
 * server at startup instead of crashing mid-request.
 */
const resolveDevVideoPath = (): string | undefined => {
  const raw = process.env.DASHRADAR_VIDEO;
  if (!raw) {
    return undefined;
  }
  const expanded = raw.startsWith("~") ? join(homedir(), raw.slice(1)) : raw;
  const absolute = resolve(expanded);
  const unreadable = new Error(
    `DASHRADAR_VIDEO does not point to a readable file: ${absolute}`,
  );
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    throw unreadable;
  }
  try {
    accessSync(absolute, fsConstants.R_OK);
  } catch {
    throw unreadable;
  }
  return absolute;
};

/**
 * Dev-only: serve the DASHRADAR_VIDEO file at /__dev-video so a local video
 * can substitute for the camera feed (see src/components/DevVideoView). Range
 * requests are honored with 206 responses because <video> seeking (scrubbing)
 * only works against a server that supports them. Serve-only: production
 * builds never include the route, and __DEV_VIDEO_URL__ compiles to null.
 * Takes the resolved path rather than resolving it itself, so the resolution
 * (and the config-load-time throw on a bad path) only ever runs for a
 * `pnpm dev` run, never for a build or test run with DASHRADAR_VIDEO set.
 */
const devVideo = (path: string | undefined): Plugin => ({
  name: "dev-video",
  apply: "serve",
  configureServer(server) {
    if (!path) {
      return;
    }
    server.middlewares.use((req, res, next) => {
      const [pathname] = (req.url ?? "").split("?");
      if (pathname !== DEV_VIDEO_ROUTE) {
        next();
        return;
      }
      const { size } = statSync(path);
      res.setHeader(
        "Content-Type",
        VIDEO_CONTENT_TYPES[extname(path).toLowerCase()] ??
          "application/octet-stream",
      );
      res.setHeader("Accept-Ranges", "bytes");
      // A read failure mid-stream (file deleted or permissions changed after
      // startup) must end the response, not crash the dev server: pipe() does
      // not forward 'error' events from its source.
      const pipeOrFail = (stream: ReturnType<typeof createReadStream>) => {
        stream.on("error", () => {
          if (!res.headersSent) {
            res.statusCode = 500;
          }
          res.end();
        });
        stream.pipe(res);
      };
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
      if (match && (match[1] !== "" || match[2] !== "")) {
        // "bytes=a-b", "bytes=a-" (open end), or "bytes=-n" (suffix).
        const start =
          match[1] === ""
            ? Math.max(0, size - Number(match[2]))
            : Number(match[1]);
        const end =
          match[1] === "" || match[2] === ""
            ? size - 1
            : Math.min(Number(match[2]), size - 1);
        if (start >= size || start > end) {
          res.statusCode = 416;
          res.setHeader("Content-Range", `bytes */${size}`);
          res.end();
          return;
        }
        res.statusCode = 206;
        res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
        res.setHeader("Content-Length", end - start + 1);
        pipeOrFail(createReadStream(path, { start, end }));
        return;
      }
      res.setHeader("Content-Length", size);
      pipeOrFail(createReadStream(path));
    });
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

/**
 * Release identifier for uploaded source maps. Must match the runtime `release`
 * in src/instrument.ts (both built from __APP_VERSION__ and __COMMIT_SHA__) so
 * production stack traces resolve against the artifacts uploaded here.
 */
const SENTRY_RELEASE = `dashradar@${APP_VERSION}+${SHORT_COMMIT_SHA}`;

/**
 * True when a Sentry auth token is available (set in the Vercel build
 * environment). Source-map generation and upload are gated on it, so ordinary
 * builds without the token skip both and never emit orphan .map files.
 */
const SENTRY_SOURCE_MAPS_ENABLED: boolean = !!process.env.SENTRY_AUTH_TOKEN;

/**
 * Upload source maps to Sentry so production (minified) stack traces resolve to
 * original source, and annotate React component names while at it. Runs only
 * when SENTRY_SOURCE_MAPS_ENABLED, and must come after every other plugin. The
 * org auth token embeds its own region (the org is in Sentry's EU region), so
 * no url is set here. The token is a secret read from the environment, never
 * committed.
 */
const sentrySourceMaps = (): Plugin[] =>
  SENTRY_SOURCE_MAPS_ENABLED
    ? sentryVitePlugin({
        org: "derek-petersen",
        project: "dashradar",
        authToken: process.env.SENTRY_AUTH_TOKEN,
        release: { name: SENTRY_RELEASE },
        reactComponentAnnotation: { enabled: true },
        sourcemaps: { filesToDeleteAfterUpload: ["./dist/**/*.map"] },
      })
    : [];

export default defineConfig(({ command }) => {
  // Resolved (and validated) only for an actual dev-server run: a build or
  // test run with a stale/invalid DASHRADAR_VIDEO left over in the
  // environment must still degrade to the null define below, not throw at
  // config load.
  const devVideoPath = command === "serve" ? resolveDevVideoPath() : undefined;
  return {
    define: {
      __APP_VERSION__: JSON.stringify(APP_VERSION),
      __COMMIT_SHA__: JSON.stringify(SHORT_COMMIT_SHA),
      // Non-null only for a dev-server run with DASHRADAR_VIDEO set, so every
      // production branch keyed on it is statically dead and minified away.
      __DEV_VIDEO_URL__: JSON.stringify(devVideoPath ? DEV_VIDEO_ROUTE : null),
    },
    // "hidden" emits source maps but strips the sourceMappingURL comment, so
    // browsers never load them; the Sentry plugin uploads them and deletes the
    // .map files from dist afterward. Off entirely when the token is absent.
    build: { sourcemap: SENTRY_SOURCE_MAPS_ENABLED ? "hidden" : false },
    plugins: [
      react(),
      tailwindcss(),
      commitShaMeta(),
      ortRuntime(),
      devVideo(devVideoPath),
      pwa(),
      ...sentrySourceMaps(),
    ],
    resolve: { tsconfigPaths: true },
    server: { headers: CROSS_ORIGIN_ISOLATION_HEADERS },
    preview: { headers: CROSS_ORIGIN_ISOLATION_HEADERS },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./vitest.setup.ts"],
      include: ["**/*.{test,spec}.?(c|m)[jt]s?(x)", "**/tests.[jt]s?(x)"],
    },
  };
});
