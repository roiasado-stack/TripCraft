// Runs api/share-og.ts locally, without Vercel, against the LOCAL Supabase.
//
//   npm run build
//   npx vite-node scripts/share-og-local.ts            # serves on :5181
//   curl http://localhost:5181/share/<slug>
//
// It plays Vercel's part: /index.html is the built dist/index.html (a static
// file), and /share/:slug is rewritten to the function as ?slug=, as in
// vercel.json. Env comes from .env.localstack (never production). Run through
// vite-node because the function imports .ts files with .js specifiers.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const PORT = Number(process.env.PORT ?? 5181);

for (const line of readFileSync(join(ROOT, ".env.localstack"), "utf8").split(/\r?\n/)) {
  const m = /^\s*(VITE_SUPABASE_URL|VITE_SUPABASE_PUBLISHABLE_KEY)\s*=\s*(.*?)\s*$/.exec(line);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(process.env.VITE_SUPABASE_URL ?? ""))
  throw new Error(".env.localstack must point at the local Supabase");

const { GET } = await import("../api/share-og.ts");

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  if (url.pathname === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(readFileSync(join(ROOT, "dist", "index.html")));
    return;
  }
  const share = /^\/share\/([^/]+)$/.exec(url.pathname);
  if (!share) {
    res.writeHead(404).end();
    return;
  }
  const rewritten = new URL(`/api/share-og?slug=${share[1]}`, url.origin);
  const response = await GET(new Request(rewritten, { headers: { cookie: req.headers.cookie ?? "" } }));
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(await response.text());
}).listen(PORT, () => console.log(`share-og local on http://localhost:${PORT}/share/<slug>`));
