// Repo rules from CLAUDE.md that tsc and ESLint cannot see. Fast, no network,
// no database. Run: npm run rules (also part of npm run check).
//
// To allow a real exception, add it to ALLOW below with the reason — never
// loosen a rule to make a change pass.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const problems = [];
const fail = (file, line, rule, text) =>
  problems.push(`${relative(ROOT, file).replaceAll("\\", "/")}${line ? `:${line}` : ""}  [${rule}]  ${text}`);

function walk(dir, exts, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

// Known, deliberate exceptions -------------------------------------------------
const ALLOW = {
  // Third-party brand colours (WhatsApp, Google logo), the browser theme-color
  // meta tag, and the default value of the user-picked agency colour.
  hex: new Set(["#25D366", "#4285F4", "#34A853", "#FBBC05", "#EA4335", "#16233a", "#12b3b0"]),
  // Its check is a SELECT of today's total (a number), not a zero-rows query.
  migrationCheck: new Set(["014_app_daily_cap.sql"]),
};

// 1. Source files ----------------------------------------------------------------
const src = walk(join(ROOT, "src"), [".ts", ".tsx"]).filter((f) => !/\.test\.tsx?$/.test(f));
const PHYSICAL = /(?<![\w-])-?(?:(?:ml|mr|pl|pr|left|right)-[\w[\]./]+|(?:border|rounded)-[lr](?:-[\w[\]./]+)?(?![\w-]))/g;
const BANNED_IMPORTS = [
  [/from ["'](react-icons|@heroicons\/|@fortawesome\/|@phosphor-icons\/)/, "icons come from lucide-react only"],
  [/from ["'](@mui\/|antd|@chakra-ui\/|@mantine\/|@radix-ui\/|@headlessui\/)/, "use the primitives in src/components/ui.tsx"],
  [/from ["'](@tanstack\/react-query|swr|zustand|redux|@reduxjs\/|jotai|recoil)/, "no data layer or global store — query Supabase in the component"],
  [/from ["'](i18next|react-i18next|react-intl)/, "no i18n layer — Hebrew strings inline"],
];

for (const file of src) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const rel = relative(ROOT, file).replaceAll("\\", "/");
  lines.forEach((line, i) => {
    const n = i + 1;
    if (/^\s*(\/\/|\*)/.test(line)) return;

    for (const hex of line.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []) {
      if (ALLOW.hex.has(hex)) continue;
      fail(file, n, "no-hex", `${hex} — use a semantic colour from src/styles.css (bg-primary, text-muted-foreground…)`);
    }

    if (/className|cn\(|clsx\(/.test(line) || /^\s*["'`]/.test(line)) {
      for (const m of line.match(PHYSICAL) ?? []) {
        // Decorative blur blobs may sit at physical corners (CLAUDE.md), and
        // left-1/2 + -translate-x-1/2 centres an element, which has no side.
        if (/\bblur-(2xl|3xl|\[)/.test(line) && /pointer-events-none/.test(line)) continue;
        if (m === "left-1/2" && /-translate-x-1\/2/.test(line)) continue;
        fail(file, n, "rtl-logical", `${m} — use ms-/me-/ps-/pe-/start-/end- in this RTL app`);
      }
    }

    for (const [re, why] of BANNED_IMPORTS) if (re.test(line)) fail(file, n, "banned-import", why);

    if (/createClient\s*[<(]/.test(line) && rel !== "src/lib/supabase.ts")
      fail(file, n, "one-client", "use the single supabase client from @/lib/supabase");
    if (/createClient\s*</.test(line)) fail(file, n, "untyped-client", "the client is untyped on purpose — assert row shapes at the call site");
  });
}

// The public brochure is served to anonymous visitors and reads only via RPC.
{
  const file = join(ROOT, "src/routes/SharePage.tsx");
  readFileSync(file, "utf8").split(/\r?\n/).forEach((line, i) => {
    if (/supabase\s*\.\s*from\(/.test(line))
      fail(file, i + 1, "share-rpc-only", "SharePage reads through get_shared_trip(slug) only — add fields there, not table reads");
  });
}

// 2. package.json ------------------------------------------------------------------
{
  const file = join(ROOT, "package.json");
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  const banned = /^(@tanstack\/react-query|swr|zustand|redux|@reduxjs\/toolkit|jotai|recoil|i18next|react-i18next|react-intl|@mui\/.*|antd|@chakra-ui\/.*|@mantine\/.*|react-icons|@heroicons\/.*|@fortawesome\/.*|supabase-typegen)$/;
  for (const d of deps) if (banned.test(d)) fail(file, 0, "banned-dependency", `${d} — see CLAUDE.md`);
}

// 3. Migrations ----------------------------------------------------------------------
const migDir = join(ROOT, "supabase/migrations");
const migs = readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort();
const nums = migs.map((f) => Number(f.slice(0, 3)));
migs.forEach((f, i) => {
  const file = join(migDir, f);
  if (!/^\d{3}_[a-z0-9_]+\.sql$/.test(f)) fail(file, 0, "migration-name", "name it NNN_snake_case.sql");
  if (i > 0 && nums[i] !== nums[i - 1] + 1) fail(file, 0, "migration-order", `expected ${String(nums[i - 1] + 1).padStart(3, "0")}_… (numbers must be unique and consecutive)`);
});

for (const f of migs) {
  const file = join(migDir, f);
  const num = Number(f.slice(0, 3));
  const sql = readFileSync(file, "utf8");
  const code = sql.replace(/--.*$/gm, "");

  for (const [, table] of code.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+(?:public\.)?(\w+)/gi)) {
    if (!new RegExp(`ALTER TABLE\\s+(?:public\\.)?${table}\\s+ENABLE ROW LEVEL SECURITY`, "i").test(code))
      fail(file, 0, "rls-required", `table ${table} is created without ENABLE ROW LEVEL SECURITY`);
  }

  // 013 closed every anon door; nothing after it may reopen one.
  if (num >= 13) {
    code.split(/;\s*/).forEach((stmt) => {
      const s = stmt.replace(/\s+/g, " ").trim();
      if (/^GRANT\b/i.test(s) && /\banon\b/i.test(s) && !/EXECUTE ON FUNCTION public\.(get_shared_trip|invite_preview)\(/i.test(s))
        fail(file, 0, "no-anon", `grant to anon: "${s.slice(0, 90)}…"`);
      if (/^CREATE POLICY\b/i.test(s) && /\bTO\b[^;]*\banon\b/i.test(s))
        fail(file, 0, "no-anon", `policy for anon: "${s.slice(0, 90)}…"`);
      if (/^CREATE POLICY "shared read"/i.test(s)) fail(file, 0, "no-anon", "\"shared read\" policies were removed in 013 — use get_shared_trip");
    });
    if (!ALLOW.migrationCheck.has(f) && !/^--.*\b((must|should) return zero rows|zero rows =)/im.test(sql))
      fail(file, 0, "migration-check", "end the migration with the check query that must return zero rows");
  }
}

if (problems.length) {
  console.log(problems.join("\n"));
  console.log(`\n${problems.length} rule violation(s). See CLAUDE.md.`);
  process.exit(1);
}
console.log(`repo rules: ok (${src.length} source files, ${migs.length} migrations)`);
