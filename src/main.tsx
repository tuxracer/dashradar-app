import "./instrument";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { reactErrorHandler } from "@sentry/react";
import { registerSW } from "virtual:pwa-register";
import { Analytics } from "@vercel/analytics/react";
import { isTrackingOptedOut } from "privacy-signals";
import { trackPwaInstall } from "@/lib/pwaInstall";
import { requestPersistentStorage } from "@/lib/serviceWorker";
// The unqualified entrypoints, never the per-subset ones. These carry a
// `unicode-range` per subset, which is what lets the browser download only the
// subset a glyph actually needs (Latin, here, and never Devanagari). The
// `latin-*.css` / `latin-ext-*.css` files ship the same @font-face without any
// unicode-range, so importing two of them declares competing rules for one
// family+weight and the last one silently wins, leaving the HUD with a subset
// that has no ASCII in it. Devanagari is kept out of the Workbox precache by
// globIgnores in vite.config.ts instead, which is where that cost really was.
import "@fontsource/rajdhani/500.css";
import "@fontsource/rajdhani/600.css";
import "@fontsource/rajdhani/700.css";
import "./globals.css";
import App from "./App";

registerSW();
requestPersistentStorage();
trackPwaInstall();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Missing #root element");
}

createRoot(rootElement, {
  // Route the three React 19 root error callbacks through Sentry so uncaught,
  // boundary-caught, and recoverable render errors are all reported.
  onUncaughtError: reactErrorHandler(),
  onCaughtError: reactErrorHandler(),
  onRecoverableError: reactErrorHandler(),
}).render(
  <StrictMode>
    <App />
    {/* Honor Do Not Track / Global Privacy Control: beforeSend gates both page
        views and every custom track() call, so returning null when the user has
        opted out suppresses all analytics from one place. Only a definitive
        "not opted out" (=== false) lets an event through; null means the
        signals could not be read, which is not consent. Dev builds are
        treated the same as an active opt-out, so a dev session never emits
        analytics events. */}
    <Analytics
      beforeSend={(event) =>
        !import.meta.env.DEV && isTrackingOptedOut() === false ? event : null
      }
    />
  </StrictMode>,
);
