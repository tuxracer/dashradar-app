import "./instrument";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { reactErrorHandler } from "@sentry/react";
import { registerSW } from "virtual:pwa-register";
import { Analytics } from "@vercel/analytics/react";
import { isDoNotTrackEnabled } from "@/lib/doNotTrack";
import { trackPwaInstall } from "@/lib/pwaInstall";
import { requestPersistentStorage } from "@/lib/serviceWorker";
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
        opted out suppresses all analytics from one place. Dev builds are
        treated the same as an active DNT signal, so a dev session never emits
        analytics events. */}
    <Analytics
      beforeSend={(event) =>
        import.meta.env.DEV || isDoNotTrackEnabled() ? null : event
      }
    />
  </StrictMode>,
);
