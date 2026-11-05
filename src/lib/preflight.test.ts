import { describe, expect, it } from "vitest";
import { hoursLabel, preflightChecklist } from "./preflight";
import type { Trip } from "./types";

const INSURANCE = "לרכוש ביטוח נסיעות מיד עם קניית הכרטיסים, ולשמור את הפוליסה";

const checklist = () => preflightChecklist({} as Trip, [], []);

describe("preflightChecklist: travel insurance", () => {
  it("uses the agreed wording, once", () => {
    const matches = checklist().filter((i) => i.title.includes("ביטוח"));
    expect(matches.map((i) => i.title)).toEqual([INSURANCE]);
  });

  it("sits in the earliest group, not two days before the flight", () => {
    const list = checklist();
    const insurance = list.find((i) => i.title === INSURANCE)!;
    expect(insurance.hours_before).toBe(Math.max(...list.map((i) => i.hours_before)));
    expect(hoursLabel(insurance.hours_before)).toBe("שבוע לפני");
  });

  it("stays ordered from earliest to latest", () => {
    const hours = checklist().map((i) => i.hours_before);
    expect(hours).toEqual([...hours].sort((a, b) => b - a));
  });
});
