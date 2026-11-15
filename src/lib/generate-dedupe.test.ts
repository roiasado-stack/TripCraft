import { describe, expect, it } from "vitest";
import { dropDuplicates, dupKey, normalizeTitle, type DupRow } from "../../supabase/functions/generate/dedupe";

type Item = { row: DupRow; wikiTitle?: string | null };
const item = (title: string, extra: Partial<DupRow> = {}, wikiTitle: string | null = null): Item => ({
  row: { title, category: "activity", day_date: "2027-02-01", ...extra },
  wikiTitle,
});
const titles = (list: Item[]) => list.map((i) => i.row.title);

describe("normalizeTitle", () => {
  it("ignores parentheticals, quotes, niqqud and case", () => {
    expect(normalizeTitle("קברי המלכים (Tombs of the Kings)")).toBe(normalizeTitle("קברי המלכים"));
    expect(normalizeTitle('אונסק"ו')).toBe(normalizeTitle("אונסק״ו"));
    expect(normalizeTitle("Wat  Arun")).toBe("wat arun");
    expect(normalizeTitle("(Wat Arun)")).toBe("wat arun");
    expect(normalizeTitle("!!!")).toBe("");
  });
});

describe("dropping duplicates in the merged itinerary", () => {
  it("drops the same place planned by two parts", () => {
    const merged = [
      item("הארמון הגדול", { day_date: "2027-02-02" }),
      item("שוק צף", { day_date: "2027-02-03" }),
      item("הארמון  הגדול!", { day_date: "2027-02-12" }),
    ];
    expect(titles(dropDuplicates(merged, [], true))).toEqual(["הארמון הגדול", "שוק צף"]);
  });

  it("drops a place already in the trip", () => {
    const existing: DupRow[] = [{ title: "וואט פו", category: "activity", day_date: "2027-02-01" }];
    expect(dropDuplicates([item("וואט פו", { day_date: "2027-02-09" })], existing, true)).toEqual([]);
  });

  it("lets meals, free time and transport repeat on other days only", () => {
    const merged = [
      item("ארוחת בוקר במלון", { category: "food", day_date: "2027-02-01" }),
      item("ארוחת בוקר במלון", { category: "food", day_date: "2027-02-02" }),
      item("ארוחת בוקר במלון", { category: "food", day_date: "2027-02-02" }),
    ];
    expect(dropDuplicates(merged, [], true)).toHaveLength(2);
    expect(dupKey(merged[0].row, true)).toBe("2027-02-01|ארוחת בוקר במלון");
  });

  it("knows one place under two Hebrew names by its Wikipedia article", () => {
    const merged = [
      item("הארמון המלכותי", { day_date: "2027-02-02" }, "Grand Palace"),
      item("הארמון הגדול של בנגקוק", { day_date: "2027-02-13" }, "grand palace"),
      item("וואט ארון", { day_date: "2027-02-13" }, "Wat Arun"),
    ];
    expect(titles(dropDuplicates(merged, [], true))).toEqual(["הארמון המלכותי", "וואט ארון"]);
  });

  it("doesn't use the article for meals, or outside the itinerary", () => {
    const meals = [
      item("ארוחת ערב בשוק", { category: "food" }, "Chatuchak Weekend Market"),
      item("שוק סוף השבוע צ'טוצ'אק", { category: "activity" }, "Chatuchak Weekend Market"),
    ];
    expect(dropDuplicates(meals, [], true)).toHaveLength(2);
    const suggestions = [item("א", {}, "Grand Palace"), item("ב", {}, "Grand Palace")];
    expect(dropDuplicates(suggestions, [], false)).toHaveLength(2);
  });

  it("keeps an item whose title has no letters (nothing to compare)", () => {
    expect(dropDuplicates([item("!!!"), item("!!!")], [], true)).toHaveLength(2);
  });
});
