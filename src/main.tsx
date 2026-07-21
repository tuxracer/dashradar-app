import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { Analytics } from "@vercel/analytics/react";
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

createRoot(rootElement).render(
  <StrictMode>
    <App />
    <Analytics />
  </StrictMode>,
);
