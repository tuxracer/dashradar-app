import "./instrument";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { reactErrorHandler } from "@sentry/react";
import { registerSW } from "virtual:pwa-register";
import { Analytics } from "@vercel/analytics/react";
import { isTrackingOptedOut } from "privacy-signals";
import { trackPwaInstall } from "@/lib/pwaInstall";
import { requestPersistentStorage } from "@/lib/serviceWorker";
// Latin subsets only. Rajdhani is a Devanagari-and-Latin typeface, and the
// unqualified 500/600/700 entrypoints pull every subset: 234 KB of the 319 KB
// of font bytes were Devanagari glyphs that the Workbox precache stored on
// every install and nothing ever rendered, since the HUD is uppercase Latin.
// latin-ext stays (38 KB) as cheap cover for accented characters.
import "@fontsource/rajdhani/latin-500.css";
import "@fontsource/rajdhani/latin-600.css";
import "@fontsource/rajdhani/latin-700.css";
import "@fontsource/rajdhani/latin-ext-500.css";
import "@fontsource/rajdhani/latin-ext-600.css";
import "@fontsource/rajdhani/latin-ext-700.css";
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
