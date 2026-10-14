import { describe, expect, it } from "vitest";
import {
  AGENT_MIN_PHOTOS_PER_DAY,
  adminAgentErrorHe,
  agentPhotoLimit,
  agentsCountHe,
  formatUsd,
  groupAgents,
  limitsDraft,
  requestsCountHe,
  usageLevel,
  usagePercent,
  usdOfLimit,
  validateAgentLimits,
} from "./agent-admin";
import type { AgentAccountUsage } from "./types";

const OK = { ai_daily_usd: "3", ai_monthly_usd: "15", google_daily: "20", max_active_trips: "30" };

describe("agentPhotoLimit", () => {
  it("never goes below the photo floor generate enforces", () => {
    expect(AGENT_MIN_PHOTOS_PER_DAY).toBe(30);
    expect(agentPhotoLimit(0)).toBe(30);
    expect(agentPhotoLimit(20)).toBe(30);
    expect(agentPhotoLimit(80)).toBe(80);
  });
});

describe("validateAgentLimits", () => {
  it("accepts the defaults and parses numbers", () => {
    expect(validateAgentLimits(OK)).toEqual({
      ok: true,
      values: { ai_daily_usd: 3, ai_monthly_usd: 15, google_daily: 20, max_active_trips: 30 },
    });
  });

  it("accepts the DB ceilings and zero", () => {
    const r = validateAgentLimits({ ai_daily_usd: "10", ai_monthly_usd: "500", google_daily: "100", max_active_trips: "0" });
    expect(r.ok).toBe(true);
  });

  it("keeps an agent's AI day below the $15 app-wide cap", () => {
    const r = validateAgentLimits({ ...OK, ai_daily_usd: "15" });
    expect(r).toEqual({ ok: false, errors: { ai_daily_usd: "המקסימום הוא 10" } });
  });

  it("accepts decimals with up to two places for dollars, trimmed", () => {
    const r = validateAgentLimits({ ...OK, ai_daily_usd: " 2.5 ", ai_monthly_usd: "12.75" });
    expect(r).toMatchObject({ ok: true, values: { ai_daily_usd: 2.5, ai_monthly_usd: 12.75 } });
  });

  it("rejects values above each ceiling", () => {
    const r = validateAgentLimits({ ai_daily_usd: "10.01", ai_monthly_usd: "501", google_daily: "101", max_active_trips: "501" });
    expect(r).toEqual({
      ok: false,
      errors: {
        ai_daily_usd: "המקסימום הוא 10",
        ai_monthly_usd: "המקסימום הוא 500",
        google_daily: "המקסימום הוא 100",
        max_active_trips: "המקסימום הוא 500",
      },
    });
  });

  it("rejects empty, negative, non-numeric and fractional counts", () => {
    const r = validateAgentLimits({ ai_daily_usd: "", ai_monthly_usd: "-1", google_daily: "2.5", max_active_trips: "abc" });
    expect(r).toEqual({
      ok: false,
      errors: {
        ai_daily_usd: "חובה למלא",
        ai_monthly_usd: "מספר בלבד, למשל 3 או 2.5",
        google_daily: "מספר שלם בלבד",
        max_active_trips: "מספר שלם בלבד",
      },
    });
  });

  it("rejects more than two decimal places for dollars", () => {
    const r = validateAgentLimits({ ...OK, ai_daily_usd: "1.234" });
    expect(r).toEqual({ ok: false, errors: { ai_daily_usd: "עד שתי ספרות אחרי הנקודה" } });
  });

  it("round-trips the current limits through the draft (NUMERIC arrives as a string)", () => {
    const draft = limitsDraft({ ai_daily_usd: "3.00" as unknown as number, ai_monthly_usd: 15, google_daily: 20, max_active_trips: 30 });
    expect(draft).toEqual(OK);
  });
});

describe("usagePercent / usageLevel", () => {
  it("is a clamped rounded share", () => {
    expect(usagePercent(1.2, 3)).toBe(40);
    expect(usagePercent(5, 3)).toBe(100);
    expect(usagePercent(0, 3)).toBe(0);
  });

  it("treats a zero limit as full once anything was used", () => {
    expect(usagePercent(0, 0)).toBe(0);
    expect(usagePercent(0.01, 0)).toBe(100);
    expect(usageLevel(0, 0)).toBe("full");
  });

  it("levels: ok below 80%, high from 80%, full at the limit", () => {
    expect(usageLevel(1, 3)).toBe("ok");
    expect(usageLevel(2.4, 3)).toBe("high");
    expect(usageLevel(3, 3)).toBe("full");
    expect(usageLevel(0, 20)).toBe("ok");
  });

  it("copes with NUMERIC values that arrive as strings", () => {
    expect(usagePercent("1.5" as unknown as number, "3.00" as unknown as number)).toBe(50);
  });
});

describe("formatting", () => {
  it("formats dollars with an LRM, whole amounts without decimals", () => {
    expect(formatUsd(1.2)).toBe("‎$1.20");
    expect(formatUsd(3)).toBe("‎$3");
    expect(formatUsd("0.5" as unknown as number)).toBe("‎$0.50");
    expect(usdOfLimit(1.2, 3)).toBe("‎$1.20 מתוך ‎$3");
  });

  it("counts in Hebrew", () => {
    expect(agentsCountHe(1)).toBe("סוכן אחד");
    expect(agentsCountHe(4)).toBe("4 סוכנים");
    expect(requestsCountHe(1)).toBe("בקשה אחת");
    expect(requestsCountHe(2)).toBe("2 בקשות");
  });

  it("maps RPC errors to Hebrew", () => {
    expect(adminAgentErrorHe({ code: "42501", message: "forbidden" })).toContain("הרשאת מנהל");
    expect(adminAgentErrorHe({ code: "P0002", message: "agent_request_not_found" })).toContain("לא נמצאה");
    expect(adminAgentErrorHe({ code: "23514", message: "check" })).toContain("מחוץ לטווח");
    expect(adminAgentErrorHe(null)).toBe("הפעולה לא הצליחה. נסו שוב.");
  });
});

describe("groupAgents", () => {
  it("splits by status and keeps order", () => {
    const base = { email: null, agency_name: "x", phone: null } as unknown as AgentAccountUsage;
    const rows = [
      { ...base, user_id: "1", status: "pending" },
      { ...base, user_id: "2", status: "active" },
      { ...base, user_id: "3", status: "suspended" },
      { ...base, user_id: "4", status: "active" },
    ] as AgentAccountUsage[];
    const g = groupAgents(rows);
    expect(g.pending.map((r) => r.user_id)).toEqual(["1"]);
    expect(g.active.map((r) => r.user_id)).toEqual(["2", "4"]);
    expect(g.suspended.map((r) => r.user_id)).toEqual(["3"]);
  });
});
