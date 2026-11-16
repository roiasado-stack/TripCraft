// Generates supabase/functions/_shared/airport-zones.data.ts: IATA code → IANA time zone
// for every airport with scheduled passenger service, grouped by zone to stay small.
//
//   node scripts/gen-airport-zones.mjs
//
// Sources (both downloaded fresh on every run; nothing is cached in the repo):
// - OurAirports (https://ourairports.com/data/) — which airports have scheduled service and
//   their IATA codes. "All data is released to the Public Domain".
// - mwgg/Airports (https://github.com/mwgg/Airports) — the IANA zone of each airport.
//   MIT licence, © 2014 mwgg. Credited on /credits (src/routes/LegalPages.tsx).
// - IANA tz database zone.tab (https://github.com/eggert/tz) — which zones belong to which
//   country. Public domain. mwgg derives zones from coordinates, and near borders that is
//   wrong in ways that matter (Ramon/ETM came out as Asia/Amman, whose DST differs from
//   Israel's). So a zone is kept only if zone.tab lists it for the airport's country; when it
//   doesn't, or mwgg has none, a country with exactly one zone gets that zone, and any other
//   airport is left out.
//
// An airport missing from either source is left out: zoneOf() returns null for it and the
// app falls back to showing the ticket's wall-clock time without a duration — never a guess.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const OURAIRPORTS = "https://davidmegginson.github.io/ourairports-data/airports.csv";
const MWGG = "https://raw.githubusercontent.com/mwgg/Airports/master/airports.json";
const ZONE_TAB = "https://raw.githubusercontent.com/eggert/tz/main/zone.tab";
const OUT = join(process.cwd(), "supabase/functions/_shared/airport-zones.data.ts");

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

// Minimal RFC 4180 parser: quoted fields may hold commas and doubled quotes.
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const IANA = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){1,2}$/;
const validZone = (tz) => {
  if (!tz || !IANA.test(tz)) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; }
};

const [csv, json, zoneTab] = await Promise.all([get(OURAIRPORTS), get(MWGG), get(ZONE_TAB)]);
const mwgg = JSON.parse(json);

const zonesByCountry = new Map(); // ISO country → zones tzdb lists for it
for (const line of zoneTab.split("\n")) {
  if (!line || line.startsWith("#")) continue;
  const [cc, , tz] = line.split("\t");
  if (!zonesByCountry.has(cc)) zonesByCountry.set(cc, []);
  zonesByCountry.get(cc).push(tz);
}

const tzByIata = new Map();
for (const a of Object.values(mwgg)) {
  if (/^[A-Z]{3}$/.test(a.iata ?? "") && validZone(a.tz) && !tzByIata.has(a.iata)) tzByIata.set(a.iata, a.tz);
}

const [header, ...rows] = parseCsv(csv);
const col = (name) => header.indexOf(name);
const iCode = col("iata_code"), iSched = col("scheduled_service"), iType = col("type");
const iCountry = col("iso_country");
const iIcao = col("icao_code"), iIdent = col("ident"), iGps = col("gps_code");

const zones = new Map(); // zone → Set<iata>
let scheduled = 0, corrected = 0, filled = 0, missing = [];
for (const r of rows) {
  const iata = (r[iCode] ?? "").trim();
  if (r[iSched] !== "yes" || !/^[A-Z]{3}$/.test(iata) || r[iType] === "closed") continue;
  scheduled++;
  const raw = tzByIata.get(iata) ?? [r[iIcao], r[iGps], r[iIdent]].map((k) => mwgg[k]?.tz).find(validZone);
  const own = zonesByCountry.get(r[iCountry]) ?? [];
  let tz = raw && own.includes(raw) ? raw : null;
  if (!tz && own.length === 1 && validZone(own[0])) {
    tz = own[0];
    if (raw) corrected++; else filled++;
  }
  if (!tz) { missing.push(`${iata}(${r[iCountry]}${raw ? ` ${raw}` : ""})`); continue; }
  if (!zones.has(tz)) zones.set(tz, new Set());
  zones.get(tz).add(iata);
}

const grouped = Object.fromEntries(
  [...zones.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([tz, set]) => [tz, [...set].sort().join(" ")]),
);
const count = Object.values(grouped).reduce((n, s) => n + s.split(" ").length, 0);

// MIT requires the copyright and permission notice in copies of the data.
const MIT_NOTICE = [
  "mwgg/Airports licence (MIT):",
  "Copyright (c) 2014 mwgg",
  "Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the \"Software\"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:",
  "The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.",
  "THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.",
];

const body =
  `// GENERATED by scripts/gen-airport-zones.mjs on ${new Date().toISOString().slice(0, 10)} — do not edit by hand.\n` +
  `// IATA → IANA zone for ${count} airports with scheduled service, grouped by zone.\n` +
  `// Data: OurAirports (public domain) + mwgg/Airports (MIT, © 2014 mwgg).\n` +
  MIT_NOTICE.map((l) => `// ${l}\n`).join("") +
  `export const AIRPORT_ZONES: Record<string, string> = ${JSON.stringify(grouped, null, 0).replace(/","/g, '",\n"')};\n`;
writeFileSync(OUT, body);
console.log(`scheduled airports with IATA: ${scheduled}; written: ${count} in ${zones.size} zones; ` +
  `corrected to the country's zone: ${corrected}; filled from the country: ${filled}; left out: ${missing.length}`);
if (missing.length) console.log(`no zone: ${missing.slice(0, 60).join(" ")}${missing.length > 60 ? " …" : ""}`);
