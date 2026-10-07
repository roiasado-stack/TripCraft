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
  // meta tag (it needs hex: #060f1e / #f1f6fb are the dark / light --background),
  // and the default value of the user-picked agency colour (#12b3b0).
  hex: new Set(["#25D366", "#4285F4", "#34A853", "#FBBC05", "#EA4335", "#060f1e", "#f1f6fb", "#12b3b0"]),
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

    // Trip dates are the traveller's calendar day. `new Date("2026-11-15")` is UTC
    // midnight (the day before west of Greenwich) and toISOString() is the UTC day
    // (yesterday in Israel until 3am) — both shipped as bugs. trip-dates.ts is the
    // one place that converts.
    if (rel !== "src/lib/trip-dates.ts") {
      if (/toISOString\(\)\s*\.slice\(\s*0\s*,\s*10\s*\)/.test(line))
        fail(file, n, "local-date", "that's the UTC day, not the traveller's — use localDateString() from @/lib/trip-dates");
      if (/new Date\([^)]*\b(start_date|end_date|check_in|check_out|day_date)\b/.test(line))
        fail(file, n, "local-date", "a date-only string parses as UTC midnight — use parseLocalDate() from @/lib/trip-dates");
    }
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

// The "is this a photo?" filter exists twice — in the app and in the generate
// Edge Function (Deno can't import from src/). They must stay the same pattern.
{
  const pattern = (rel) => {
    const text = readFileSync(join(ROOT, rel), "utf8");
    const m = text.match(/const NOT_A_PHOTO =\s*(\/.*\/[a-z]*);/);
    return m ? m[1] : null;
  };
  const app = pattern("src/lib/photo-url.ts");
  const fn = pattern("supabase/functions/generate/index.ts");
  if (!app || !fn) fail(join(ROOT, "src/lib/photo-url.ts"), 0, "photo-filter-sync", "NOT_A_PHOTO not found in one of the two files");
  else if (app !== fn)
    fail(join(ROOT, "supabase/functions/generate/index.ts"), 0, "photo-filter-sync", "NOT_A_PHOTO differs from src/lib/photo-url.ts — keep the two identical");
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

// 4. Colour contrast ---------------------------------------------------------------
// Every text/background token pair in src/styles.css must meet WCAG AA (4.5:1) in
// light and dark, and white hero text must stay readable on both ends of
// --gradient-sea. Measured from the tokens themselves, so a palette tweak that
// breaks a pair fails here instead of on someone's phone. (Icon tiles: 3:1.)
{
  const file = join(ROOT, "src/styles.css");
  const css = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const block = (sel) => {
    const i = css.indexOf(`\n${sel} {\n`);
    if (i < 0) return {};
    const body = css.slice(i, css.indexOf("\n}\n", i + 1));
    return Object.fromEntries([...body.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)].map((m) => [m[1], m[2].trim()]));
  };
  const light = block(":root");
  const modes = { light, dark: { ...light, ...block(".dark") } };

  // oklch → linear sRGB (clamped to the gamut); relative luminance uses linear values.
  const linear = (v) => {
    const m = v.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)(%?))?\s*\)/);
    if (!m) return null;
    const [L, C, h] = [+m[1], +m[2], +m[3]];
    const alpha = m[4] === undefined ? 1 : m[5] ? +m[4] / 100 : +m[4];
    const a = C * Math.cos((h * Math.PI) / 180);
    const b = C * Math.sin((h * Math.PI) / 180);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const rgb = [
      4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
    ].map((x) => Math.min(1, Math.max(0, x)));
    return { rgb, alpha };
  };
  const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Browsers blend a translucent colour over what's beneath in gamma-encoded sRGB.
  const encode = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
  const decode = (x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  const over = (top, alpha, base) => top.map((t, i) => decode(encode(t) * alpha + encode(base[i]) * (1 - alpha)));
  const ratio = (x, y) => {
    const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p);
    return (hi + 0.05) / (lo + 0.05);
  };
  const token = (vars, name) => {
    if (typeof name === "object") {
      const tint = token(vars, name.tint);
      const base = token(vars, name.over);
      return tint && base ? { rgb: over(tint.rgb, name.alpha, base.rgb), alpha: 1 } : null;
    }
    let v = vars[name];
    for (let k = 0; k < 5 && v?.startsWith("var("); k++) v = vars[v.slice(4, -1).trim()];
    return v ? linear(v) : null;
  };

  const PAIRS = [
    ["--foreground", "--background"], ["--foreground", "--card"], ["--card-foreground", "--card"],
    ["--popover-foreground", "--popover"], ["--muted-foreground", "--card"], ["--muted-foreground", "--background"],
    ["--muted-foreground", "--muted"], ["--secondary-foreground", "--secondary"],
    ["--primary", "--card"], ["--primary", "--background"], ["--primary", "--primary-soft"], ["--primary-foreground", "--primary"],
    ["--accent", "--card"], ["--accent", "--background"], ["--accent", "--accent-soft"], ["--accent-foreground", "--accent"],
    ["--destructive", "--card"], ["--destructive-foreground", "--destructive"], ["--sun-foreground", "--sun"],
    ["--tile-foreground", "--tile", 3], ["--tile-accent-foreground", "--tile-accent", 3],
    // Error boxes: text-destructive on bg-destructive/10 (import dialogs, the agent).
    ["--destructive", { tint: "--destructive", alpha: 0.1, over: "--card" }],
    ["--destructive", { tint: "--destructive", alpha: 0.1, over: "--background" }],
  ];
  const white = [1, 1, 1];
  for (const [mode, vars] of Object.entries(modes)) {
    for (const [fg, bg, min = 4.5] of PAIRS) {
      const f = token(vars, fg);
      const b = token(vars, bg);
      if (!f || !b) {
        fail(file, 0, "contrast", `${mode}: can't read ${JSON.stringify(!f ? fg : bg)} as oklch()`);
        continue;
      }
      if (f.alpha < 1 || b.alpha < 1) continue; // translucent pairs depend on what's underneath
      const r = ratio(f.rgb, b.rgb);
      const bgName = typeof bg === "object" ? `${bg.tint}/${bg.alpha * 100} over ${bg.over}` : bg;
      if (r < min) fail(file, 0, "contrast", `${mode}: ${fg} on ${bgName} is ${r.toFixed(2)}:1 (needs ${min}:1)`);
    }
    // A hero photo can be anything, so judge its scrim against the worst case: a
    // pure-white pixel. Stops in the text zone (bottom 45%) must keep white text readable.
    for (const [, color, pos] of (vars["--hero-scrim"] ?? "").matchAll(/(oklch\([^)]*\))\s+([\d.]+)%/g)) {
      if (+pos > 45) continue;
      const c = linear(color);
      const r = ratio(white, over(c.rgb, c.alpha, white));
      if (r < 4.5) fail(file, 0, "contrast", `${mode}: white text on --hero-scrim at ${pos}% over a white photo is ${r.toFixed(2)}:1 (needs 4.5:1)`);
    }
    for (const stop of vars["--gradient-sea"]?.match(/oklch\([^)]*\)/g) ?? []) {
      const r = ratio(white, linear(stop).rgb);
      if (r < 4.5) fail(file, 0, "contrast", `${mode}: white hero text on --gradient-sea stop ${stop} is ${r.toFixed(2)}:1 (needs 4.5:1)`);
    }
  }
}

if (problems.length) {
  console.log(problems.join("\n"));
  console.log(`\n${problems.length} rule violation(s). See CLAUDE.md.`);
  process.exit(1);
}
console.log(`repo rules: ok (${src.length} source files, ${migs.length} migrations)`);
