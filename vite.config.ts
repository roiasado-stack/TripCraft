import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    host: true,
    // Phone testing over a tunnel: the request arrives under the tunnel's own
    // hostname, and Vite rejects hosts it doesn't know. Needed for HTTPS on a
    // real device — clipboard, native share and home-screen install are all
    // inert over plain http on the LAN.
    allowedHosts: [".trycloudflare.com", ".ngrok-free.app", ".loca.lt"],
  },
});
