// Runs supabase/tests/*.sql against a THROWAWAY database built from the repo files, inside the
// LOCAL Supabase container (Docker), never production. Usage: npm run test:db [-- <name filter>]
//
// Each run:
//   1. creates an empty database next to `postgres` (Roi's local data there is only read, by pg_dump)
//   2. copies Supabase's own schemas (auth, storage, vault, extensions…) into it from `postgres`,
//      minus everything the repo itself put there (any object in public, policies on storage.*,
//      triggers on auth.*, anything that mentions public., pg_cron and vector)
//   3. applies supabase/schema.sql + every supabase/migrations/0NN_*.sql in order, as `postgres`
//   4. runs each test file after _helpers.sql inside one transaction that is rolled back
//   5. drops the database
// So a function that exists only in the local DB (applied by hand, missing from a migration)
// is not there, and the test that needs it fails.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CONTAINER = "supabase_db_tripcraft";
const DIR = "supabase/tests";
const PREFIX = "tripcraft_test_";
const filter = process.argv[2];
const started = Date.now();

function psql(sql, { db = "postgres", user = "postgres", stopOnError = true } = {}) {
  const args = ["exec", "-i", CONTAINER, "psql", "-U", user, "-d", db, "-X", "-q", "-t"];
  if (stopOnError) args.push("-v", "ON_ERROR_STOP=1");
  return spawnSync("docker", args, { input: sql, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function errorLines(stderr) {
  return (stderr ?? "")
    .split(/\r?\n/)
    .filter((l) => /ERROR|FAIL|LINE|DETAIL|HINT|CONTEXT/.test(l))
    .map((l) => `    ${l.trim()}`)
    .join("\n");
}

const ping = spawnSync("docker", ["exec", CONTAINER, "pg_isready", "-U", "postgres"], { encoding: "utf8" });
if (ping.status !== 0) {
  console.error(`Local Supabase is not running (${CONTAINER}). Start Docker Desktop, then: npx supabase start`);
  process.exit(2);
}

// --- throwaway database --------------------------------------------------------------------------
const testDb = `${PREFIX}${started}_${process.pid}`;

function dropDb(name) {
  psql(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE);`, { user: "supabase_admin" });
}

// Leftovers from a run that was killed hard (older than an hour; a parallel run is never touched).
const stale = psql(`SELECT datname FROM pg_database WHERE datname LIKE '${PREFIX}%';`, { user: "supabase_admin" });
for (const name of (stale.stdout ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) {
  const ts = Number(name.slice(PREFIX.length).split("_")[0]);
  if (ts && started - ts > 60 * 60 * 1000) dropDb(name);
}

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  dropDb(testDb);
}
process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(143);
});

function fail(step, detail) {
  console.log(`✗ build failed at ${step}`);
  if (detail) console.log(detail);
  cleanup();
  process.exit(1);
}

// 1. empty database, same encoding/locale as `postgres`
const created = psql(
  `CREATE DATABASE "${testDb}" OWNER postgres TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8';`,
  { user: "supabase_admin" },
);
if (created.status !== 0) fail("CREATE DATABASE", errorLines(created.stderr));

// 2. Supabase's own schemas, copied from `postgres` without anything the repo created
const dump = spawnSync("docker", ["exec", CONTAINER, "pg_dump", "-U", "supabase_admin", "-d", "postgres", "-s", "-N", "public"], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
if (dump.status !== 0) fail("pg_dump of Supabase's schemas from postgres", errorLines(dump.stderr));

// pg_dump's plain format: a preamble, then one block per object, each starting with
// "--\n-- Name: <name>; Type: <type>; Schema: <schema>; Owner: <owner>\n--".
const blocks = dump.stdout.split(/(?=^--\r?\n-- (?:Data for )?Name: )/m);
const baseline = blocks
  .filter((block, i) => {
    if (i === 0) return true; // SET … preamble
    const head = /^-- (?:Data for )?Name: (.*?); Type: (.*?); Schema: (.*?);/m.exec(block);
    if (!head) return true;
    const [, name, type, schema] = head;
    if (schema === "public" || schema === "cron") return false; // repo / pg_cron objects
    if (/\bpg_cron\b|\bvector\b|^SCHEMA cron$/.test(name)) return false; // pg_cron: stubbed below; vector: the repo creates it
    if (type === "POLICY" && schema === "storage") return false; // Supabase ships none; ours come from the repo
    if (type === "TRIGGER" && schema === "auth") return false; // Supabase ships none; ours come from the repo
    // Any other trigger/policy/view/grant outside public that points into public was put there by the repo.
    // (Function bodies are not checked: Supabase's realtime functions mention public.* in comments.)
    if (/^(TRIGGER|POLICY|VIEW|ACL|DEFAULT ACL)$/.test(type) && /\bpublic\./.test(block)) return false;
    return true;
  })
  .join("");

const restored = psql(baseline, { db: testDb, user: "supabase_admin" });
if (restored.status !== 0) fail("restoring Supabase's schemas into the test database", errorLines(restored.stderr));

// public as Supabase sets it up (same grants and default privileges as the `postgres` database), and a
// stand-in for pg_cron: the extension can only live in cron.database_name (= postgres), so the test
// database gets a cron schema whose schedule/unschedule do nothing.
const setup = `
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
${["postgres", "supabase_admin"]
  .map(
    (r) => `
ALTER DEFAULT PRIVILEGES FOR ROLE ${r} IN SCHEMA public GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE ${r} IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE ${r} IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;`,
  )
  .join("")}
CREATE SCHEMA cron;
GRANT USAGE ON SCHEMA cron TO postgres;
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint
  LANGUAGE sql AS $$ SELECT 0::bigint $$;
CREATE FUNCTION cron.unschedule(job_name text) RETURNS boolean
  LANGUAGE sql AS $$ SELECT true $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA cron TO postgres;
`;
const prepared = psql(setup, { db: testDb, user: "supabase_admin" });
if (prepared.status !== 0) fail("public grants / cron stub", errorLines(prepared.stderr));

// 3. the repo's schema: schema.sql, then every migration in order
const migrations = readdirSync("supabase/migrations")
  .filter((f) => /^\d{3}_.*\.sql$/.test(f))
  .sort()
  .map((f) => join("supabase/migrations", f));
for (const file of [join("supabase", "schema.sql"), ...migrations]) {
  // The only edit: CREATE EXTENSION pg_cron is refused outside cron.database_name; the stub stands in.
  const sql = readFileSync(file, "utf8").replace(/CREATE EXTENSION IF NOT EXISTS pg_cron\s*;/gi, "-- (test-db: pg_cron stubbed)");
  const applied = psql(sql, { db: testDb });
  if (applied.status !== 0) fail(file.replace(/\\/g, "/"), errorLines(applied.stderr));
}
const buildSecs = ((Date.now() - started) / 1000).toFixed(1);
console.log(`built ${testDb} from schema.sql + ${migrations.length} migrations (${buildSecs}s)\n`);

// 4. the tests
const helpers = readFileSync(join(DIR, "_helpers.sql"), "utf8");
const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql") && !f.startsWith("_") && (!filter || f.includes(filter)))
  .sort();

let failed = 0;
let passed = 0;
for (const file of files) {
  const sql = `BEGIN;\n${helpers}\n${readFileSync(join(DIR, file), "utf8")}\nROLLBACK;\n`;
  const run = psql(sql, { db: testDb });
  const lines = (run.stderr ?? "").split(/\r?\n/);
  const oks = lines.filter((l) => l.includes("NOTICE:  ok")).length;
  passed += oks;
  if (run.status === 0) {
    console.log(`✓ ${file}  (${oks} checks)`);
  } else {
    failed++;
    console.log(`✗ ${file}  (${oks} passed before the failure)`);
    for (const l of lines.filter((l) => l.includes("ERROR") || l.includes("FAIL") || l.includes("LINE"))) {
      console.log(`    ${l.trim()}`);
    }
  }
}

// 5. drop it
cleanup();
console.log(`\n${passed} checks passed, ${failed} file(s) failed  (${((Date.now() - started) / 1000).toFixed(1)}s)`);
process.exit(failed ? 1 : 0);
