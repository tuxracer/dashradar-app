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

const PRECACHE_MAX_FILE_SIZE = 5_000_000; // headroom so the single no-split bundle (libsodium + supabase) stays precacheable as it grows past workbox's 2 MiB default

const pwa = () =>
  VitePWA({
    registerType: "autoUpdate",
    manifest: {
      name: "TuxBank",
      short_name: "TuxBank",
      description:
        "Local-first budget calendar that tracks deposits and withdrawals on a full-page month view, works offline with no account, and offers optional end-to-end encrypted sync across devices.",
      display: "standalone",
      start_url: "/",
      // Suppress the plugin's defaults (#ffffff / #42b883); undefined keys are
      // dropped from the serialized manifest.
      background_color: undefined,
      theme_color: undefined,
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
