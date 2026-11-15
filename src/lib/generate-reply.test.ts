import { describe, expect, it } from "vitest";
import {
  dropStrayOutsideStrings,
  extractJson,
  extractJsonObjects,
  extractText,
  repairStrayQuotes,
} from "../../supabase/functions/generate/reply";

const titles = (text: string) => ((extractJson(text)?.items as { title: string }[] | undefined) ?? []).map((i) => i.title);

describe("reading the model's reply", () => {
  it("joins every text block, whatever comes first", () => {
    expect(extractText({ content: [{ type: "thinking", thinking: "" }, { type: "text", text: "a" }, { type: "text", text: "b" }] })).toBe("a\nb");
    expect(extractText(null)).toBe("");
  });

  it("joins items from several JSON blocks", () => {
    const text = 'יום 1:\n```json\n{"items":[{"title":"א"}]}\n```\nיום 2:\n```json\n{"items":[{"title":"ב"}]}\n```';
    expect(titles(text)).toEqual(["א", "ב"]);
  });

  it("repairs a Hebrew abbreviation written with a plain quote", () => {
    expect(titles('{"items":[{"title":"ביקור בבית חב"ד"}]}')).toEqual(["ביקור בבית חב״ד"]);
  });

  it("keeps a week whose reply put quotation marks around a name", () => {
    const text =
      `{"items":[{"day_date":"2027-01-10","title":"ארוחת ערב במסעדת "בלו אלפנט"","category":"food"},` +
      `{"day_date":"2027-01-11","title":"שוק "צ'טוצ'אק" הגדול","category":"activity"},` +
      `{"day_date":"2027-01-12","title":"וואט פו","description":"המקדש של \\"הבודהה השוכב\\"","category":"activity"}]}`;
    expect(titles(text)).toEqual(["ארוחת ערב במסעדת ״בלו אלפנט״", "שוק ״צ'טוצ'אק״ הגדול", "וואט פו"]);
    expect((extractJson(text)?.items as { description?: string }[])[2].description).toBe('המקדש של "הבודהה השוכב"');
  });

  // The reply that lost Bangkok's week on 2026-11-15: a lone rafe (U+05BF) between two fields.
  it("keeps a week whose reply had a stray Hebrew point between two fields", () => {
    const text =
      `{"items":[{"day_date":"2027-01-14","start_time":"14:00","title":"סיור בלומפיני פארק",` +
      `"description":"הליכה רגועה בפארק המרכזי של בנגקוק",\u05BF"category":"activity","lat":13.73,"lng":100.54},` +
      `{"day_date":"2027-01-14","title":"שוק לילה","category":"activity","ok":true,"x":null,"n":-1.5e2}]}`;
    expect(titles(text)).toEqual(["סיור בלומפיני פארק", "שוק לילה"]);
  });

  it("drops stray marks only outside strings, and never a letter", () => {
    expect(dropStrayOutsideStrings(`{"a":"ש\u05BFל",\u05BF "b": [1, true]}`)).toBe(`{"a":"ש\u05BFל", "b": [1, true]}`);
    // Misread strings put words outside: they stay, so the block fails rather than losing them.
    expect(dropStrayOutsideStrings(`{"t":"מסעדת "בלו אלפנט""}`)).toBe(`{"t":"מסעדת "בלו אלפנט""}`);
  });

  it("leaves valid JSON exactly as it was", () => {
    const valid = '{"items":[{"title":"x","tags":["a","b"],"n":1,"empty":"","q":"say \\"hi\\""}]}';
    expect(repairStrayQuotes(valid)).toBe(valid);
    expect(dropStrayOutsideStrings(valid)).toBe(valid);
    expect(extractJsonObjects(valid)).toEqual([JSON.parse(valid)]);
  });

  it("still gives nothing for a reply cut off mid-JSON", () => {
    expect(extractJson('{"items":[{"title":"א"},{"title":"ב')).toBeNull();
  });
});
