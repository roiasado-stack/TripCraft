import { describe, expect, it } from "vitest";
import { parseTags, tagsToText } from "./suggestion-tags";

describe("parseTags", () => {
  it("splits on commas and trims", () => {
    expect(parseTags("משפחתי, חינם ,  נוף")).toEqual(["משפחתי", "חינם", "נוף"]);
  });

  it("drops blanks, so an empty field clears the tags", () => {
    expect(parseTags("")).toEqual([]);
    expect(parseTags(" , ,")).toEqual([]);
    expect(parseTags("ילדים,,")).toEqual(["ילדים"]);
  });

  it("collapses inner spaces and drops repeats", () => {
    expect(parseTags("שקיעה  יפה, שקיעה יפה, kids")).toEqual(["שקיעה יפה", "kids"]);
  });
});

describe("tagsToText", () => {
  it("round-trips through parseTags", () => {
    const tags = ["משפחתי", "free entry"];
    expect(parseTags(tagsToText(tags))).toEqual(tags);
  });

  it("handles missing tags", () => {
    expect(tagsToText(null)).toBe("");
    expect(tagsToText(undefined)).toBe("");
  });
});
