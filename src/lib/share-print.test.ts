import { describe, expect, it } from "vitest";
import { isPrintRequest, sharePrintUrl, shouldAutoPrint } from "./share-print";

describe("isPrintRequest", () => {
  it("is true for print=1, alone or with other params", () => {
    expect(isPrintRequest("?print=1")).toBe(true);
    expect(isPrintRequest("?lang=en&print=1")).toBe(true);
    expect(isPrintRequest("print=1")).toBe(true);
  });

  it("is false without it or with any other value", () => {
    expect(isPrintRequest("")).toBe(false);
    expect(isPrintRequest("?lang=en")).toBe(false);
    expect(isPrintRequest("?print=0")).toBe(false);
    expect(isPrintRequest("?print=true")).toBe(false);
    expect(isPrintRequest("?print")).toBe(false);
    expect(isPrintRequest("?xprint=1")).toBe(false);
  });
});

describe("shouldAutoPrint", () => {
  const search = "?print=1";

  it("prints a loaded trip that asked for it", () => {
    expect(shouldAutoPrint({ search, state: "ready", printed: false })).toBe(true);
  });

  it("never prints the spinner or the not-found page", () => {
    expect(shouldAutoPrint({ search, state: "loading", printed: false })).toBe(false);
    expect(shouldAutoPrint({ search, state: "notfound", printed: false })).toBe(false);
  });

  it("prints only once", () => {
    expect(shouldAutoPrint({ search, state: "ready", printed: true })).toBe(false);
  });

  it("doesn't print a page opened without ?print=1", () => {
    expect(shouldAutoPrint({ search: "?lang=en", state: "ready", printed: false })).toBe(false);
  });
});

describe("sharePrintUrl", () => {
  it("builds the print link from the slug", () => {
    expect(sharePrintUrl("https://tripcraft.co.il", "119389c4581f3b2384")).toBe(
      "https://tripcraft.co.il/share/119389c4581f3b2384?print=1",
    );
  });

  it("is empty for a trip that has no slug", () => {
    expect(sharePrintUrl("https://tripcraft.co.il", null)).toBe("");
    expect(sharePrintUrl("https://tripcraft.co.il", "")).toBe("");
  });

  it("encodes a slug that isn't URL-safe", () => {
    expect(sharePrintUrl("https://x.test", "a/b?c")).toBe("https://x.test/share/a%2Fb%3Fc?print=1");
  });
});
