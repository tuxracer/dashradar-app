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

const PRECACHE_MAX_FILE_SIZE = 5_000_000; // headroom so the single no-split bundle stays precacheable as it grows past workbox's 2 MiB default

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
