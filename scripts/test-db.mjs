// Runs supabase/tests/*.sql against the LOCAL Supabase database (Docker), never
// production. Each file runs after _helpers.sql inside one transaction that is
// rolled back. Usage: npm run test:db [-- <name filter>]
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CONTAINER = "supabase_db_tripcraft";
const DIR = "supabase/tests";
const filter = process.argv[2];

const ping = spawnSync("docker", ["exec", CONTAINER, "pg_isready", "-U", "postgres"], { encoding: "utf8" });
if (ping.status !== 0) {
  console.error(`Local Supabase is not running (${CONTAINER}). Start Docker Desktop, then: npx supabase start`);
  process.exit(2);
}

const helpers = readFileSync(join(DIR, "_helpers.sql"), "utf8");
const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql") && !f.startsWith("_") && (!filter || f.includes(filter)))
  .sort();

let failed = 0;
let passed = 0;
for (const file of files) {
  const sql = `BEGIN;\n${helpers}\n${readFileSync(join(DIR, file), "utf8")}\nROLLBACK;\n`;
  const run = spawnSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-t", "-v", "ON_ERROR_STOP=1"],
    { input: sql, encoding: "utf8" },
  );
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

console.log(`\n${passed} checks passed, ${failed} file(s) failed`);
process.exit(failed ? 1 : 0);
