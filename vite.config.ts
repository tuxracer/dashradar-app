import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { execFileSync } from "node:child_process";
import type { Plugin } from "vite";

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

const commitShaMeta = (): Plugin => {
  const sha = resolveCommitSha();
  return {
    name: "commit-sha-meta",
    transformIndexHtml: (html) =>
      html.replace(
        "</head>",
        `  <meta name="version" content="${sha}" />\n  </head>`,
      ),
  };
};

// Generous ceiling for the JS/CSS bundle. The ONNX runtime .wasm that Vite
// emits into dist/assets (~23.5 MB) is deliberately excluded from globPatterns
// below: onnxruntime-web always fetches its wasm/mjs from cdn.jsdelivr.net
// unless env.backends.onnx.wasm.wasmPaths is set (it isn't, here), so the
// bundled copy is dead weight. The jsdelivr fetch is covered by the
// "ort-runtime" CacheFirst route instead, which is what makes offline
// cold-loads work after the first run.
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
          // onnxruntime-web may fetch its .wasm/.mjs from jsdelivr instead of
          // the bundle depending on how the build resolves it; cache-first so
          // the app still cold-loads offline after the first run.
          urlPattern: ({ url }) => url.hostname === "cdn.jsdelivr.net",
          handler: "CacheFirst",
          options: {
            cacheName: "ort-runtime",
            expiration: { maxEntries: 8 },
            cacheableResponse: { statuses: [0, 200] },
          },
        },
      ],
    },
  });

export default defineConfig({
  plugins: [react(), tailwindcss(), commitShaMeta(), pwa()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.{test,spec}.?(c|m)[jt]s?(x)", "**/tests.[jt]s?(x)"],
  },
});
