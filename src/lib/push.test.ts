import { describe, expect, it } from "vitest";
import { base64UrlToBytes, isIOSDevice, pushSupport } from "./push";

describe("base64UrlToBytes", () => {
  it("decodes base64url without padding", () => {
    // "hello" → aGVsbG8 (base64 "aGVsbG8=")
    expect(Array.from(base64UrlToBytes("aGVsbG8"))).toEqual([104, 101, 108, 108, 111]);
  });

  it("maps - and _ back to + and /", () => {
    // bytes 0xfb 0xff → base64 "+/8=" → base64url "-_8"
    expect(Array.from(base64UrlToBytes("-_8"))).toEqual([0xfb, 0xff]);
  });

  it("decodes a 65-byte uncompressed VAPID public key", () => {
    const key =
      "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";
    const bytes = base64UrlToBytes(key);
    expect(bytes.length).toBe(65);
    expect(bytes[0]).toBe(0x04);
  });
});

const base = { hasSW: true, hasPushManager: true, hasNotification: true, isIOS: false, isStandalone: false };

describe("pushSupport", () => {
  it("is supported on a desktop/Android browser with all the APIs", () => {
    expect(pushSupport(base)).toBe("supported");
  });

  it("asks iOS Safari (not from the home screen) to add the app first", () => {
    expect(pushSupport({ ...base, isIOS: true })).toBe("ios-needs-home-screen");
    // Even when the tab happens to expose the APIs.
    expect(pushSupport({ ...base, isIOS: true, hasPushManager: false })).toBe("ios-needs-home-screen");
  });

  it("is supported on iOS from the home screen", () => {
    expect(pushSupport({ ...base, isIOS: true, isStandalone: true })).toBe("supported");
  });

  it("is unsupported on an old iOS home-screen app without PushManager", () => {
    expect(pushSupport({ ...base, isIOS: true, isStandalone: true, hasPushManager: false })).toBe("unsupported");
  });

  it("is unsupported when any API is missing", () => {
    expect(pushSupport({ ...base, hasSW: false })).toBe("unsupported");
    expect(pushSupport({ ...base, hasPushManager: false })).toBe("unsupported");
    expect(pushSupport({ ...base, hasNotification: false })).toBe("unsupported");
  });
});

describe("isIOSDevice", () => {
  it("detects iPhone", () => {
    expect(isIOSDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", 5)).toBe(true);
  });
  it("detects iPadOS posing as a Mac", () => {
    expect(isIOSDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe(true);
  });
  it("does not flag a real Mac or Android", () => {
    expect(isIOSDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0)).toBe(false);
    expect(isIOSDevice("Mozilla/5.0 (Linux; Android 14; Pixel 8)", 5)).toBe(false);
  });
});
