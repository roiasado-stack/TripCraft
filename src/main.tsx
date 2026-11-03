import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App";

// iOS Safari only applies :active (the `pressable` press state) once the page
// listens for touches.
document.addEventListener("touchstart", () => {}, { passive: true });

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
