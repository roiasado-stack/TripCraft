// Serves the app against LOCAL Supabase so a phone on the same Wi-Fi can open it.
// Vite listens on every interface (:5175) and the Supabase URL is rewritten from
// 127.0.0.1 to this PC's LAN address — env vars set here beat .env.localstack.
// Usage: node scripts/dev-phone.mjs   (or the "tripcraft-phone" launch config)
import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 5175;

// Real adapters only: Hyper-V / WSL / VPN adapters also carry private addresses
// a phone can't reach.
const isVirtual = (name) => /vEthernet|WSL|Hyper-V|VirtualBox|VMware|Loopback|Tailscale|ZeroTier/i.test(name);
const isPrivate = (ip) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
const candidates = Object.entries(networkInterfaces())
  .filter(([name]) => !isVirtual(name))
  .flatMap(([name, addrs]) => (addrs ?? []).map((a) => ({ name, ...a })))
  .filter((a) => a.family === "IPv4" && !a.internal && isPrivate(a.address));
const lan = candidates.find((a) => /Wi-?Fi|Wireless|WLAN/i.test(a.name)) ?? candidates[0];
if (!lan) {
  console.error("No Wi-Fi/LAN address found — is this PC on the same network as the phone?");
  process.exit(2);
}

console.log(`\n  Open on the phone (same Wi-Fi):  http://${lan.address}:${PORT}\n`);
const vite = spawn(`npx vite --mode localstack --host 0.0.0.0 --port ${PORT} --strictPort`, {
  cwd: ROOT,
  shell: true,
  stdio: "inherit",
  env: { ...process.env, VITE_SUPABASE_URL: `http://${lan.address}:54321` },
});
vite.on("exit", (code) => process.exit(code ?? 0));
