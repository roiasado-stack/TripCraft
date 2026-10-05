import { describe, expect, it } from "vitest";
import { can, type TripAction } from "./permissions";
import type { TripRole } from "./types";

// Must match the RLS matrix that supabase/tests/02_trip_roles.sql checks.
const MATRIX: Record<TripRole, Record<TripAction, boolean>> = {
  owner: { manage: true, edit: true, participate: true },
  editor: { manage: false, edit: true, participate: true },
  participant: { manage: false, edit: false, participate: true },
  viewer: { manage: false, edit: false, participate: false },
};

describe("can()", () => {
  for (const [role, actions] of Object.entries(MATRIX)) {
    for (const [action, allowed] of Object.entries(actions)) {
      it(`${role} ${allowed ? "may" : "may not"} ${action}`, () => {
        expect(can(role as TripRole, action as TripAction)).toBe(allowed);
      });
    }
  }

  it("denies everything while the role is still loading or missing", () => {
    for (const action of ["manage", "edit", "participate"] as TripAction[]) {
      expect(can(null, action)).toBe(false);
      expect(can(undefined, action)).toBe(false);
    }
  });
});
