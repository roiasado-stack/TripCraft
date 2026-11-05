import { describe, expect, it } from "vitest";
import { canEditDocument, documentTravellerProblem } from "./document-rules";
import type { TripRole } from "./types";

const travellers = [{ id: "p1" }, { id: "p2" }];

describe("documentTravellerProblem()", () => {
  it("asks for a traveller on a passport without one", () => {
    expect(documentTravellerProblem("passport", "", travellers)).toBe("pick_traveller");
    expect(documentTravellerProblem("passport", null, travellers)).toBe("pick_traveller");
  });

  it("rejects a traveller who is no longer on the trip", () => {
    expect(documentTravellerProblem("passport", "gone", travellers)).toBe("pick_traveller");
  });

  it("says to add a traveller first when the trip has none", () => {
    expect(documentTravellerProblem("passport", "", [])).toBe("no_travellers");
  });

  it("accepts a passport tied to one of the trip's travellers", () => {
    expect(documentTravellerProblem("passport", "p2", travellers)).toBeNull();
  });

  it("leaves every other category free, with or without travellers", () => {
    for (const category of ["flight", "hotel", "insurance", "car", "other", "unknown-from-newer-build"]) {
      expect(documentTravellerProblem(category, "", travellers)).toBeNull();
      expect(documentTravellerProblem(category, "", [])).toBeNull();
    }
  });
});

describe("canEditDocument()", () => {
  // Must match the "uploader update" cases in supabase/tests/10_document_edit.sql.
  const mine = { uploaded_by: "me" };
  const theirs = { uploaded_by: "someone" };

  it("lets the uploader edit while they can participate", () => {
    for (const role of ["owner", "editor", "participant"] as TripRole[]) {
      expect(canEditDocument(mine, "me", role)).toBe(true);
    }
  });

  it("refuses a viewer, even on a document they uploaded earlier", () => {
    expect(canEditDocument(mine, "me", "viewer")).toBe(false);
  });

  it("refuses anyone else's document, the owner's role included", () => {
    for (const role of ["owner", "editor", "participant", "viewer"] as TripRole[]) {
      expect(canEditDocument(theirs, "me", role)).toBe(false);
    }
  });

  it("refuses while the user or role is still loading", () => {
    expect(canEditDocument(mine, undefined, "owner")).toBe(false);
    expect(canEditDocument({ uploaded_by: null }, null, "owner")).toBe(false);
    expect(canEditDocument(mine, "me", null)).toBe(false);
  });
});
