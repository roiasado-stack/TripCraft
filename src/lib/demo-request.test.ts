import { describe, expect, it } from "vitest";
import { validateDemoRequest, type DemoRequestInput } from "./demo-request";

const ok: DemoRequestInput = {
  fullName: "דנה כהן",
  agencyName: "טיולי דנה",
  phone: "050-123-4567",
  email: "dana@example.com",
  tripsPerMonth: "10_30",
};

describe("validateDemoRequest", () => {
  it("accepts a complete form", () => {
    expect(validateDemoRequest(ok)).toEqual({});
  });

  it("accepts international phone formats", () => {
    expect(validateDemoRequest({ ...ok, phone: "+972 50 123 4567" })).toEqual({});
  });

  it("flags every empty field", () => {
    const errors = validateDemoRequest({ fullName: "", agencyName: "", phone: "", email: "", tripsPerMonth: "" });
    expect(Object.keys(errors).sort()).toEqual(["agencyName", "email", "fullName", "phone", "tripsPerMonth"]);
  });

  it("rejects a bad email, a short or lettered phone, and an unknown range", () => {
    expect(validateDemoRequest({ ...ok, email: "dana@" }).email).toBeDefined();
    expect(validateDemoRequest({ ...ok, phone: "12345" }).phone).toBeDefined();
    expect(validateDemoRequest({ ...ok, phone: "call me maybe" }).phone).toBeDefined();
    expect(validateDemoRequest({ ...ok, tripsPerMonth: "" }).tripsPerMonth).toBeDefined();
  });
});
