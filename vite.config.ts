import { defineConfig } from "vitest/config";
import { configDefaults } from "vitest/config";
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
  test: {
    // Agent worktrees live under .claude/; their half-written tests are not ours.
    exclude: [...configDefaults.exclude, ".claude/**"],
  },
  server: {
    port: 5173,
    host: true,
    // Phone testing over a tunnel: the request arrives under the tunnel's own
    // hostname, and Vite rejects hosts it doesn't know. Needed for HTTPS on a
    // real device — clipboard, native share and home-screen install are all
    // inert over plain http on the LAN.
    allowedHosts: [".trycloudflare.com", ".ngrok-free.app", ".loca.lt"],
    // The dev server listens on the LAN (and on a tunnel when one is open), so
    // anything under the project root is reachable by URL. Only the app needs
    // to be: keep secrets, git history and the private business/docs folders out.
    // Patterns match absolute paths, hence the leading **/.
    fs: {
      deny: [
        ".env",
        ".env.*",
        "*.{crt,pem,key}",
        "**/.git/**",
        "**/.vercel/**",
        "**/.claude/**",
        "**/supabase/.temp/**",
        "**/business/**",
        "**/n8n/**",
        "**/docs/**",
        "**/presentation/**",
        "**/marketing/**",
        "**/design/**",
        "**/evals/**",
        "**/*.{zip,pdf}",
        "**/CLAUDE.md",
      ],
    },
  },
});
