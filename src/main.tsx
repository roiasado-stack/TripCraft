import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App";

// iOS Safari only applies :active (the `pressable` press state) once the page
// listens for touches.
document.addEventListener("touchstart", () => {}, { passive: true });

// Routes load on demand: after a deploy, a page opened before it asks for route
// files that no longer exist. Reload to pick up the new index.html, at most once
// a minute, so a file that is really missing ends in the ErrorBoundary, not a loop.
window.addEventListener("vite:preloadError", (event) => {
  try {
    const last = Number(sessionStorage.getItem("chunk-reload-at") ?? 0);
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem("chunk-reload-at", String(Date.now()));
  } catch {
    return;
  }
  event.preventDefault();
  window.location.reload();
});

// Push notifications only (public/sw.js has no fetch handler: no offline support).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
