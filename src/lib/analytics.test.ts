import { describe, expect, it } from "vitest";
import { track, trackablePath } from "./analytics";

const loc = (pathname: string, search = "", hash = "") => ({ pathname, search, hash });
const TRIP = "3f2b8c1e-4d5a-4e6f-8a9b-0c1d2e3f4a5b";

describe("trackablePath", () => {
  it("allows the landing page, the agents page and the new-trip wizard", () => {
    expect(trackablePath(loc("/"))).toBe("/");
    expect(trackablePath(loc("/agents"))).toBe("/agents");
    expect(trackablePath(loc("/agents/"))).toBe("/agents");
    expect(trackablePath(loc("/new"))).toBe("/new");
  });

  it("keeps the audience switch and the in-page anchors", () => {
    expect(trackablePath(loc("/", "?audience=agent"))).toBe("/");
    expect(trackablePath(loc("/agents", "", "#demo"))).toBe("/agents");
    expect(trackablePath(loc("/", "", "#example"))).toBe("/");
  });

  it("reports the created-trip screen without the trip id", () => {
    expect(trackablePath(loc(`/trip/${TRIP}/created`))).toBe("/trip/created");
  });

  it("refuses anything that can carry a secret: auth return, invite, share, recovery", () => {
    expect(trackablePath(loc("/", "?code=abc123"))).toBeNull();
    expect(trackablePath(loc("/", "?audience=agent&code=abc123"))).toBeNull();
    expect(trackablePath(loc("/", "", "#access_token=xyz&type=recovery"))).toBeNull();
    expect(trackablePath(loc("/join/secret-token"))).toBeNull();
    expect(trackablePath(loc("/share/abc123def456"))).toBeNull();
    expect(trackablePath(loc("/reset-password", "", "#access_token=xyz"))).toBeNull();
  });

  it("refuses the other screens: login, the trip itself, settings, the agency workspace", () => {
    expect(trackablePath(loc("/auth", "?next=/new"))).toBeNull();
    expect(trackablePath(loc(`/trip/${TRIP}`))).toBeNull();
    expect(trackablePath(loc(`/trip/${TRIP}/documents`))).toBeNull();
    expect(trackablePath(loc("/trip/created"))).toBeNull();
    expect(trackablePath(loc("/settings"))).toBeNull();
    expect(trackablePath(loc("/agency/new"))).toBeNull();
  });
});

describe("track", () => {
  it("does nothing, and throws nothing, when no tracker is configured", () => {
    expect(() => track("click_create_trip", { location: "hero" })).not.toThrow();
  });
});
