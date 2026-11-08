import { describe, expect, it } from "vitest";
import { AGENDA_MAX_ITEMS, sanitizeAgenda } from "../../supabase/functions/generate/agenda";

describe("sanitizeAgenda", () => {
  it("keeps valid rows and normalizes time, category and blanks", () => {
    expect(
      sanitizeAgenda([
        { day_date: "2026-11-16", start_time: "9:00", title: "  סיור במטה  ", description: "", category: "activity", location: " Hikvision HQ " },
        { day_date: "2026-11-16", start_time: "14:00:00", title: "ארוחת צהריים", category: "lunch" },
      ]),
    ).toEqual([
      { day_date: "2026-11-16", start_time: "09:00", title: "סיור במטה", description: null, category: "activity", location: "Hikvision HQ" },
      { day_date: "2026-11-16", start_time: "14:00", title: "ארוחת צהריים", description: null, category: "activity", location: null },
    ]);
  });

  it("drops rows without a valid date or a title", () => {
    expect(
      sanitizeAgenda([
        { day_date: "16/11/2026", title: "x" },
        { day_date: "2026-13-01", title: "x" },
        { day_date: "2026-11-16", title: "   " },
        { day_date: "2026-11-16" },
        null,
        "text",
      ]),
    ).toEqual([]);
  });

  it("rejects a time that isn't a clock time", () => {
    expect(sanitizeAgenda([{ day_date: "2026-11-16", start_time: "25:00", title: "x" }])[0].start_time).toBeNull();
    expect(sanitizeAgenda([{ day_date: "2026-11-16", start_time: "10:30 – 11:00", title: "x" }])[0].start_time).toBeNull();
  });

  it("orders by day but keeps the document's order inside a day (past midnight)", () => {
    const out = sanitizeAgenda([
      { day_date: "2026-11-15", start_time: "09:15", title: "נחיתה" },
      { day_date: "2026-11-14", start_time: "23:20", title: "נחיתה בהאנגג'ואו" },
      { day_date: "2026-11-14", start_time: "00:30", title: "העברה למלון" },
    ]);
    expect(out.map((i) => i.title)).toEqual(["נחיתה בהאנגג'ואו", "העברה למלון", "נחיתה"]);
  });

  it("keeps an exact repeat once", () => {
    const row = { day_date: "2026-11-16", start_time: "15:00", title: "Boat Cruise" };
    expect(sanitizeAgenda([row, { ...row, title: "boat cruise" }])).toHaveLength(1);
  });

  it("caps the list and ignores a non-array", () => {
    const many = Array.from({ length: AGENDA_MAX_ITEMS + 5 }, (_, i) => ({ day_date: "2026-11-16", title: `פריט ${i}` }));
    expect(sanitizeAgenda(many)).toHaveLength(AGENDA_MAX_ITEMS);
    expect(sanitizeAgenda({ items: [] })).toEqual([]);
  });
});
