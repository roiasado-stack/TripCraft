import { describe, expect, it } from "vitest";
import { isValidEmail, normalizeEmail, sameLeadEmail } from "./client-email";

describe("normalizeEmail", () => {
  it("trims and lower-cases, and treats blank as none", () => {
    expect(normalizeEmail("  Dana@Gmail.COM ")).toBe("dana@gmail.com");
    expect(normalizeEmail("   ")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });
});

describe("isValidEmail", () => {
  it("accepts ordinary addresses", () => {
    expect(isValidEmail("dana@gmail.com")).toBe(true);
    expect(isValidEmail(" noa@agency.co.il ")).toBe(true);
  });
  it("rejects what the database constraint rejects", () => {
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("dana")).toBe(false);
    expect(isValidEmail("dana@gmail")).toBe(false);
    expect(isValidEmail("da na@gmail.com")).toBe(false);
    expect(isValidEmail(`${"a".repeat(250)}@b.co`)).toBe(false);
  });
});

describe("sameLeadEmail", () => {
  it("ignores case and spaces, and matches no-email with blank", () => {
    expect(sameLeadEmail("dana@gmail.com", " Dana@Gmail.com")).toBe(true);
    expect(sameLeadEmail(null, "")).toBe(true);
    expect(sameLeadEmail(null, "dana@gmail.com")).toBe(false);
    expect(sameLeadEmail("dana@gmail.com", "noa@gmail.com")).toBe(false);
  });
});
