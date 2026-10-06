// Seeds the break-ui fixture trips (supabase/dev/break-ui-trip-screen.sql) into
// the LOCAL Supabase, owned by a local-only login. Never run against production:
// it reads the URL and service key from `npx supabase status`, i.e. Docker.
// Then: preview "tripcraft-local", sign in with the account below, and use the
// Demo / Worst case / Empty / One / Huge switch at the bottom of any trip.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const CONTAINER = "supabase_db_tripcraft";
const EMAIL = "breakui@test.local";
const PASSWORD = "breakui-local-only-7f3k";

const status = spawnSync("npx supabase status -o env", { encoding: "utf8", shell: true });
const env = Object.fromEntries(
  (status.stdout ?? "")
    .split(/\r?\n/)
    .map((l) => l.match(/^(\w+)="?([^"]*)"?$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
const apiUrl = env.API_URL;
const serviceKey = env.SERVICE_ROLE_KEY;
if (!apiUrl || !serviceKey || !/^http:\/\/(127\.0\.0\.1|localhost)/.test(apiUrl)) {
  console.error("Local Supabase is not running (or not on localhost). Start it with: npx supabase start");
  process.exit(2);
}

const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
const created = await fetch(`${apiUrl}/auth/v1/admin/users`, {
  method: "POST",
  headers,
  body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }),
});
if (!created.ok && created.status !== 422) {
  console.error("Could not create the local user:", created.status, await created.text());
  process.exit(1);
}

const psql = (args, input) =>
  spawnSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", ...args], {
    input,
    encoding: "utf8",
  });

const uid = psql(["-Atc", `select id from auth.users where email = '${EMAIL}'`]).stdout.trim();
if (!uid) {
  console.error(`No local user ${EMAIL}`);
  process.exit(1);
}

const run = psql(["-v", "ON_ERROR_STOP=1", "-v", `uid=${uid}`], readFileSync("supabase/dev/break-ui-trip-screen.sql", "utf8"));
if (run.status !== 0) {
  console.error(run.stderr);
  process.exit(1);
}
console.log(`Seeded 5 fixture trips for ${EMAIL} (password in this file). Open /trip/b4ea0000-0000-4000-8000-000000000002`);
