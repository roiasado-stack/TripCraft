import { describe, expect, it } from "vitest";
import { clientMessage, normalizePhone, waMeUrl } from "./whatsapp";

describe("normalizePhone", () => {
  it("turns Israeli local numbers into 972…", () => {
    expect(normalizePhone("050-1234567")).toBe("972501234567");
    expect(normalizePhone("0501234567")).toBe("972501234567");
    expect(normalizePhone(" 052 123 4567 ")).toBe("972521234567");
    expect(normalizePhone("03-1234567")).toBe("97231234567");
    expect(normalizePhone("501234567")).toBe("972501234567");
  });

  it("keeps international numbers, with or without +/00", () => {
    expect(normalizePhone("+972 50-123-4567")).toBe("972501234567");
    expect(normalizePhone("972501234567")).toBe("972501234567");
    expect(normalizePhone("00972501234567")).toBe("972501234567");
    expect(normalizePhone("+1 (212) 555-0100")).toBe("12125550100");
    expect(normalizePhone("0044 20 7946 0958")).toBe("442079460958");
  });

  it("drops the (0) people write after +972", () => {
    expect(normalizePhone("+972 (0)50-1234567")).toBe("972501234567");
    expect(normalizePhone("+9720501234567")).toBe("972501234567");
  });

  it("rejects what can't be a phone", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone("abc")).toBeNull();
    expect(normalizePhone("050-123")).toBeNull();
    expect(normalizePhone("0501234567890")).toBeNull();
    expect(normalizePhone("+0123456789")).toBeNull();
  });
});

describe("waMeUrl", () => {
  it("puts the normalized phone in the path and encodes the text", () => {
    expect(waMeUrl("050-1234567", "שלום & ברוכים")).toBe(
      `https://wa.me/972501234567?text=${encodeURIComponent("שלום & ברוכים")}`,
    );
  });

  it("encodes newlines and URLs inside the text", () => {
    const url = waMeUrl("0501234567", "a\nhttps://x.test/share/abc?x=1");
    expect(url).toContain("%0A");
    expect(url).toContain(encodeURIComponent("https://x.test/share/abc?x=1"));
  });

  it("without a usable phone lets WhatsApp ask for the recipient", () => {
    expect(waMeUrl(null, "hi")).toBe("https://wa.me/?text=hi");
    expect(waMeUrl("12", "hi")).toBe("https://wa.me/?text=hi");
  });
});

describe("clientMessage", () => {
  const shareUrl = "https://app.test/share/abcdef123456";
  const joinUrl = "https://app.test/join/tok";

  it("includes the name, the destination's city and both links", () => {
    const m = clientMessage({ clientName: "משפחת כהן", destination: "רומא, איטליה", shareUrl, joinUrl, agencyName: "טיולי גשר" });
    expect(m).toContain("היי משפחת כהן!");
    expect(m).toContain("הטיול שלכם לרומא מוכן");
    expect(m).not.toContain("איטליה");
    expect(m).toContain(shareUrl);
    expect(m).toContain(joinUrl);
    expect(m.trim().endsWith("טיולי גשר")).toBe(true);
  });

  it("doesn't promise vouchers or documents (the agent's source files stay private)", () => {
    const m = clientMessage({ clientName: "דנה", destination: "רומא", shareUrl, joinUrl });
    expect(m).not.toContain("שוברים");
    expect(m).not.toContain("מסמכים");
    expect(m).toContain(`הקישור האישי שלך להצטרפות ולעדכונים לאורך הדרך: ${joinUrl}`);
    expect(m).toContain("את בני המשפחה מזמינים מתוך האפליקציה");
  });

  it("reads naturally without a name, destination, join link or agency", () => {
    const m = clientMessage({ shareUrl });
    expect(m.startsWith("היי!")).toBe(true);
    expect(m).toContain("הטיול שלכם מוכן");
    expect(m).toContain(shareUrl);
    expect(m).not.toContain("להצטרפות");
    expect(m).not.toContain("הקישור אישי");
    expect(m).not.toContain("undefined");
    expect(m).not.toContain("null");
  });
});
