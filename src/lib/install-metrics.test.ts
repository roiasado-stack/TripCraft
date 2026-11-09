import { describe, expect, it } from "vitest";
import { isStandalone, openKey, platformFromUserAgent } from "./install-metrics";

const UA = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  ipadOld: "Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  linux: "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0",
  chromebook: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
};

describe("platformFromUserAgent", () => {
  it("reads iPhone and iPad as ios", () => {
    expect(platformFromUserAgent(UA.iphone)).toBe("ios");
    expect(platformFromUserAgent(UA.ipadOld)).toBe("ios");
  });

  it("reads iPadOS (a Mac with touch) as ios, a real Mac as desktop", () => {
    expect(platformFromUserAgent(UA.mac, 5)).toBe("ios");
    expect(platformFromUserAgent(UA.mac, 0)).toBe("desktop");
    expect(platformFromUserAgent(UA.mac)).toBe("desktop");
  });

  it("reads Android as android even though its UA says Linux", () => {
    expect(platformFromUserAgent(UA.android, 5)).toBe("android");
  });

  it("reads Windows, Linux and ChromeOS as desktop", () => {
    expect(platformFromUserAgent(UA.windows)).toBe("desktop");
    expect(platformFromUserAgent(UA.linux)).toBe("desktop");
    expect(platformFromUserAgent(UA.chromebook)).toBe("desktop");
  });

  it("falls back to other", () => {
    expect(platformFromUserAgent("")).toBe("other");
    expect(platformFromUserAgent("curl/8.0")).toBe("other");
  });
});

describe("isStandalone", () => {
  it("is true when either signal says installed", () => {
    expect(isStandalone(true, undefined)).toBe(true);
    expect(isStandalone(false, true)).toBe(true);
  });

  it("is false in a browser tab or when the APIs are missing", () => {
    expect(isStandalone(false, false)).toBe(false);
    expect(isStandalone(undefined, undefined)).toBe(false);
  });
});

describe("openKey", () => {
  it("is one key per user per day per mode", () => {
    expect(openKey("u1", "2026-11-09", true)).not.toBe(openKey("u1", "2026-11-09", false));
    expect(openKey("u1", "2026-11-09", true)).not.toBe(openKey("u1", "2026-11-10", true));
    expect(openKey("u1", "2026-11-09", true)).not.toBe(openKey("u2", "2026-11-09", true));
    expect(openKey("u1", "2026-11-09", false)).toBe(openKey("u1", "2026-11-09", false));
  });
});
