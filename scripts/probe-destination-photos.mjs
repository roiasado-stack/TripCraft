// Does the destination-photo lookup actually find photos? Runs generate's
// `scope: "destination"` prompt — read straight from the function file, with the
// same model — on a few known destinations, then the same Wikipedia lookup and
// NOT_A_PHOTO filter. Catches a prompt change that quietly stops finding photos
// (it happened: the place prompt forbade city/country articles, so no trip got one).
//
// Run after changing the photo prompt or filter: npm run probe:photos
// Costs a few cents (one small model call per destination). Needs
// ANTHROPIC_API_KEY in .env; the key is never printed. Not part of npm run check.
import { readFileSync } from "node:fs";

const src = readFileSync("supabase/functions/generate/index.ts", "utf8").replace(/\r\n/g, "\n");
const model = src.match(/const MODEL = "([^"]+)"/)?.[1];
const prompt = src.match(
  /\? `Trip destination \(may be in Hebrew, may list several places\): "\$\{query\}"\n([\s\S]*?)`\n\s*: `Place/,
)?.[1];
const notAPhotoSrc = src.match(/const NOT_A_PHOTO =\s*\/(.*)\/i;/)?.[1];
if (!model || !prompt || !notAPhotoSrc) {
  console.error("Couldn't read MODEL, the destination prompt or NOT_A_PHOTO from generate/index.ts — update this script.");
  process.exit(2);
}
const notAPhoto = new RegExp(notAPhotoSrc, "i");

let key;
try {
  key = readFileSync(".env", "utf8").match(/^ANTHROPIC_API_KEY=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
} catch {
  // no .env
}
if (!key) {
  console.error("ANTHROPIC_API_KEY not found in .env");
  process.exit(2);
}

// Each must find a photo, except the last, which must find none.
const CASES = [
  ["רומא, איטליה", true],
  ["פריז", true],
  ["יפן", true], // a country: must be a landmark, never the flag
  ["תאילנד", true],
  ["מילאנו, אגם קומו, לוצרן וחזרה דרך מינכן", true], // several places
  ["ורשה, פולין", true],
  ["יעד סודי", false],
];

let failed = 0;
for (const [query, expectPhoto] of CASES) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model,
      max_tokens: 16000,
      output_config: { effort: "low" },
      messages: [{ role: "user", content: `Trip destination (may be in Hebrew, may list several places): "${query}"\n${prompt}` }],
    }),
  });
  if (!res.ok) {
    console.log(`✗ ${query}: API ${res.status}`);
    failed++;
    continue;
  }
  const data = await res.json();
  const title = (data.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("")
    .trim()
    .replace(/^["'“”]|["'“”]$/g, "");

  let file = null;
  if (title && !/^NONE$/i.test(title)) {
    const wiki = await fetch(
      "https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1" +
        `&prop=pageimages&piprop=thumbnail&pithumbsize=1280&titles=${encodeURIComponent(title)}`,
      { headers: { "User-Agent": "TripCraft-probe/1.0 (https://tripcraft-lac.vercel.app)" } },
    );
    const url = (await wiki.json())?.query?.pages?.[0]?.thumbnail?.source ?? null;
    if (url) {
      const name = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
      if (!notAPhoto.test(name)) file = name;
    }
  }
  const ok = expectPhoto ? !!file : !file;
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${query} → ${title || "NONE"} → ${file ?? "no photo"}`);
}
console.log(failed ? `\n${failed} destination(s) didn't behave as expected.` : "\nAll destinations behaved as expected.");
process.exit(failed ? 1 : 0);
