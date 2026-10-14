import { describe, expect, it } from "vitest";
import {
  agentTripStatus,
  attentionNotes,
  boardCounters,
  matchesBoardQuery,
  needsHandling,
  sortBoard,
  tripsCountHe,
} from "./agent-board";
import type { AgentTripBoardRow } from "./types";

const TODAY = new Date(2026, 9, 13, 9, 0); // 13 Oct 2026, local

function row(patch: Partial<AgentTripBoardRow> = {}): AgentTripBoardRow {
  return {
    id: "t1",
    title: "טיול לרומא",
    destination: "רומא, איטליה",
    start_date: "2026-11-02",
    end_date: "2026-11-09",
    client_name: "משפחת לוי",
    client_phone: "050-1234567",
    is_shared: true,
    share_slug: "abcdef1234567890",
    image_url: null,
    participants_count: 4,
    members_joined: 1,
    members_pending: 0,
    passports_count: 4,
    documents_count: 6,
    bookings_count: 3,
    needs_attention: [],
    ...patch,
  };
}

describe("agentTripStatus", () => {
  it("is 'back' once the trip has ended, whatever else is flagged", () => {
    expect(agentTripStatus(row({ start_date: "2026-10-01", end_date: "2026-10-12" }), TODAY)).toBe("back");
  });

  it("is 'abroad' while the trip is on, including its first and last day", () => {
    expect(agentTripStatus(row({ start_date: "2026-10-13", end_date: "2026-10-20" }), TODAY)).toBe("abroad");
    expect(agentTripStatus(row({ start_date: "2026-10-05", end_date: "2026-10-13" }), TODAY)).toBe("abroad");
  });

  it("is 'draft' when the client hasn't got it: no public link, nobody invited", () => {
    expect(
      agentTripStatus(row({ is_shared: false, members_joined: 0, members_pending: 0, needs_attention: ["not_joined"] }), TODAY),
    ).toBe("draft");
  });

  it("a draft stays a draft even with missing passports — it hasn't been sent yet", () => {
    expect(
      agentTripStatus(row({ is_shared: false, members_joined: 0, needs_attention: ["missing_passports"] }), TODAY),
    ).toBe("draft");
  });

  it("an unshared trip someone already joined is not a draft", () => {
    expect(agentTripStatus(row({ is_shared: false, members_joined: 2 }), TODAY)).toBe("sent");
    expect(agentTripStatus(row({ is_shared: false, members_joined: 0, members_pending: 1, needs_attention: ["pending_members"] }), TODAY)).toBe("attention");
  });

  it("is 'attention' when a passport, an approval or the dates are missing", () => {
    expect(agentTripStatus(row({ needs_attention: ["missing_passports"] }), TODAY)).toBe("attention");
    expect(agentTripStatus(row({ needs_attention: ["pending_members"] }), TODAY)).toBe("attention");
    expect(agentTripStatus(row({ start_date: null, end_date: null, needs_attention: ["no_dates"] }), TODAY)).toBe("attention");
  });

  it("missing beats leaving soon", () => {
    expect(
      agentTripStatus(row({ start_date: "2026-10-16", needs_attention: ["missing_passports", "departing_soon"] }), TODAY),
    ).toBe("attention");
  });

  it("is 'soon' within a week of leaving when nothing is missing", () => {
    expect(agentTripStatus(row({ start_date: "2026-10-16", needs_attention: ["departing_soon"] }), TODAY)).toBe("soon");
  });

  it("'nobody joined yet' alone keeps a sent trip 'sent'", () => {
    expect(agentTripStatus(row({ members_joined: 0, needs_attention: ["not_joined"] }), TODAY)).toBe("sent");
  });

  it("is 'sent' otherwise", () => {
    expect(agentTripStatus(row(), TODAY)).toBe("sent");
  });

  it("reads dates as local calendar days (not UTC midnight)", () => {
    // Ends today: still abroad all day long, even late in the evening.
    const lateEvening = new Date(2026, 9, 13, 23, 30);
    expect(agentTripStatus(row({ start_date: "2026-10-10", end_date: "2026-10-13" }), lateEvening)).toBe("abroad");
  });
});

describe("needsHandling", () => {
  it("follows the board's flags", () => {
    expect(needsHandling(row())).toBe(false);
    expect(needsHandling(row({ needs_attention: ["departing_soon"] }))).toBe(true);
    expect(needsHandling(row({ needs_attention: ["not_joined"] }))).toBe(true);
  });
});

describe("attentionNotes", () => {
  it("counts missing passports and pending members in correct Hebrew", () => {
    expect(attentionNotes(row({ needs_attention: ["missing_passports"], participants_count: 4, passports_count: 3 }))).toEqual([
      "חסר דרכון אחד",
    ]);
    expect(attentionNotes(row({ needs_attention: ["missing_passports"], participants_count: 4, passports_count: 1 }))).toEqual([
      "חסרים 3 דרכונים",
    ]);
    expect(attentionNotes(row({ needs_attention: ["pending_members"], members_pending: 1 }))).toEqual(["מצטרף אחד מחכה לאישור"]);
    expect(attentionNotes(row({ needs_attention: ["pending_members"], members_pending: 2 }))).toEqual(["2 מצטרפים מחכים לאישור"]);
  });

  it("leaves 'departing soon' to the status chip", () => {
    expect(attentionNotes(row({ needs_attention: ["departing_soon", "no_dates", "not_joined"] }))).toEqual([
      "אין תאריכים",
      "אף נוסע עוד לא הצטרף",
    ]);
  });
});

describe("boardCounters", () => {
  it("shows joined and passports N/M", () => {
    expect(boardCounters(row({ members_joined: 2, passports_count: 3, participants_count: 4 }))).toBe("הצטרפו 2 · דרכונים 3/4");
  });
  it("never shows more passports than travellers", () => {
    expect(boardCounters(row({ passports_count: 5, participants_count: 4 }))).toBe("הצטרפו 1 · דרכונים 4/4");
  });
  it("says so when there are no travellers yet", () => {
    expect(boardCounters(row({ members_joined: 0, participants_count: 0, passports_count: 0 }))).toBe("הצטרפו 0 · עוד אין נוסעים");
  });
});

describe("matchesBoardQuery", () => {
  it("matches client name, destination or title, case-insensitively", () => {
    expect(matchesBoardQuery(row(), "לוי")).toBe(true);
    expect(matchesBoardQuery(row(), "איטליה")).toBe(true);
    expect(matchesBoardQuery(row({ destination: "Rome, Italy" }), "rome")).toBe(true);
    expect(matchesBoardQuery(row(), "טיול לרומא")).toBe(true);
    expect(matchesBoardQuery(row(), "פריז")).toBe(false);
  });
  it("an empty or blank query matches everything, a missing client name doesn't crash", () => {
    expect(matchesBoardQuery(row(), "")).toBe(true);
    expect(matchesBoardQuery(row(), "   ")).toBe(true);
    expect(matchesBoardQuery(row({ client_name: null }), "כהן")).toBe(false);
  });
  it("ignores extra spaces in the query", () => {
    expect(matchesBoardQuery(row(), "  משפחת   לוי ")).toBe(true);
  });
});

describe("sortBoard", () => {
  it("puts current and upcoming trips first (soonest first, undated last), then past ones latest first", () => {
    const rows = [
      row({ id: "past-old", start_date: "2026-09-01", end_date: "2026-09-05" }),
      row({ id: "undated", start_date: null, end_date: null }),
      row({ id: "later", start_date: "2026-12-01", end_date: "2026-12-05" }),
      row({ id: "past-recent", start_date: "2026-10-01", end_date: "2026-10-09" }),
      row({ id: "now", start_date: "2026-10-10", end_date: "2026-10-20" }),
      row({ id: "soon", start_date: "2026-10-15", end_date: "2026-10-18" }),
    ];
    expect(sortBoard(rows, TODAY).map((r) => r.id)).toEqual(["now", "soon", "later", "undated", "past-recent", "past-old"]);
  });
  it("does not mutate its input", () => {
    const rows = [row({ id: "b", start_date: "2026-12-01" }), row({ id: "a", start_date: "2026-11-01" })];
    sortBoard(rows, TODAY);
    expect(rows.map((r) => r.id)).toEqual(["b", "a"]);
  });
});

describe("tripsCountHe", () => {
  it("counts trips in Hebrew", () => {
    expect(tripsCountHe(0)).toBe("0 טיולים");
    expect(tripsCountHe(1)).toBe("טיול אחד");
    expect(tripsCountHe(2)).toBe("2 טיולים");
  });
});
