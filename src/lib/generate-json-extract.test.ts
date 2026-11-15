import { describe, expect, it } from "vitest";
import { extractJson, extractJsonObjects, repairStrayQuotes } from "../../supabase/functions/generate/json-extract";

const item = (day: string, title: string, description: string) =>
  `{"day_date":"${day}","start_time":"10:00","title":"${title}","description":"${description}","category":"activity"}`;
const reply = (...items: string[]) => '```json\n{"items":[\n' + items.join(",\n") + "\n]}\n```";
const titles = (text: string) =>
  ((extractJson(text)?.items as { title: string }[] | undefined) ?? []).map((i) => i.title);

describe("extractJson", () => {
  it("reads a clean fenced reply", () => {
    expect(titles(reply(item("2027-01-03", "א", "x"), item("2027-01-04", "ב", "y")))).toEqual(["א", "ב"]);
  });

  // Production 2026-11-15: one quoted place name in one description and the
  // whole 18-day itinerary (~40 items) was dropped.
  it("keeps the whole reply when a description quotes a place name", () => {
    const text = reply(
      item("2027-01-03", "העברה למלון", "נסיעה למלון בפאטונג"),
      item("2027-01-04", "ביקור במקדש", 'ביקור ב"Big Buddha" והנוף מעל המפרץ'),
      item("2027-01-05", "שייט", "שייט לאיי פי פי"),
    );
    expect(titles(text)).toEqual(["העברה למלון", "ביקור במקדש", "שייט"]);
    const desc = (extractJson(text)?.items as { description: string }[])[1].description;
    expect(desc).toBe("ביקור ב״Big Buddha״ והנוף מעל המפרץ");
  });

  it("survives a single (odd) stray quote that breaks brace matching", () => {
    const text = reply(item("2027-01-03", "קניות", 'מסך 5" בקניון'), item("2027-01-04", "חוף", "יום חוף"));
    expect(titles(text)).toEqual(["קניות", "חוף"]);
  });

  it("drops only the item that can't be repaired, keeps the rest", () => {
    const broken = '{"day_date":"2027-01-04","title":"מקדש","description":"ביקור ב"Wat Chalong", ואז ארוחה","category":"activity"}';
    const text = reply(item("2027-01-03", "א", "x"), broken, item("2027-01-05", "ג", "z"));
    expect(titles(text)).toEqual(["א", "ג"]);
  });

  it("still fixes Hebrew abbreviations with a plain quote", () => {
    expect(titles(reply(item("2027-01-03", 'בית חב"ד', 'ארוחת שבת בחב"ד')))).toEqual(["בית חב״ד"]);
  });

  it("concatenates items split across several blocks", () => {
    const text = reply(item("2027-01-03", "א", "x")) + "\n" + reply(item("2027-01-04", "ב", "y"));
    expect(titles(text)).toEqual(["א", "ב"]);
  });

  it("returns a non-items object (voucher) unchanged", () => {
    const v = extractJson('```json\n{"doc_type":"hotel","data":{"hotel_name":"Sheraton","check_in":"2027-01-10"}}\n```');
    expect(v).toEqual({ doc_type: "hotel", data: { hotel_name: "Sheraton", check_in: "2027-01-10" } });
  });

  it("is null when there is no JSON at all", () => {
    expect(extractJson("לא הצלחתי לקרוא את המסמך.")).toBeNull();
  });
});

describe("repairStrayQuotes", () => {
  it("leaves valid JSON exactly as it was", () => {
    const valid = JSON.stringify({ items: [{ a: "x", b: "", c: ["y", "z"], d: 'say "hi"', e: 1.5, f: null }] });
    expect(repairStrayQuotes(valid)).toBe(valid);
    expect(JSON.parse(repairStrayQuotes(valid))).toEqual(JSON.parse(valid));
  });

  it("turns quotes inside a value into gershayim", () => {
    expect(repairStrayQuotes('{"t":"ב"Big Buddha" היום"}')).toBe('{"t":"ב״Big Buddha״ היום"}');
  });
});

describe("extractJsonObjects", () => {
  it("counts top-level objects and ignores prose quotes outside them", () => {
    expect(extractJsonObjects('הנה "המסלול":\n{"items":[]}\nו-{"items":[{"a":1}]}')).toHaveLength(2);
  });
});
