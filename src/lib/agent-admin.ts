// Pure helpers for the admin "סוכנים" screen (agency beta, phase 4):
// limit validation that mirrors the CHECKs in migration 022, usage bars and
// Hebrew counts. No Supabase here — the RPCs stay the real authority.
import type { AgentAccountUsage } from "./types";

export type AgentLimitField = "ai_daily_usd" | "ai_monthly_usd" | "google_daily" | "max_active_trips";

export interface AgentLimits {
  ai_daily_usd: number;
  ai_monthly_usd: number;
  google_daily: number;
  max_active_trips: number;
}

export type AgentLimitDraft = Record<AgentLimitField, string>;

/**
 * Same ceilings as the agent_accounts CHECK constraints (migration 022). The
 * AI day stays below the $15/day app-wide cap in the Edge Functions, so one
 * agent can't use up the whole app's day.
 */
export const AGENT_LIMIT_BOUNDS: Record<AgentLimitField, { max: number; integer: boolean }> = {
  ai_daily_usd: { max: 10, integer: false },
  ai_monthly_usd: { max: 500, integer: false },
  google_daily: { max: 100, integer: true },
  max_active_trips: { max: 500, integer: true },
};

/**
 * Google place photos per agent per day never go below this: generate allows
 * max(google_daily, PLACE_PHOTOS_PER_USER_PER_DAY) — keep the two in step.
 */
export const AGENT_MIN_PHOTOS_PER_DAY = 30;

/** The photo limit generate actually enforces for an agent with this google_daily. */
export function agentPhotoLimit(googleDaily: number): number {
  return Math.max(Number(googleDaily) || 0, AGENT_MIN_PHOTOS_PER_DAY);
}

export function limitsDraft(a: AgentLimits): AgentLimitDraft {
  return {
    ai_daily_usd: String(Number(a.ai_daily_usd)),
    ai_monthly_usd: String(Number(a.ai_monthly_usd)),
    google_daily: String(a.google_daily),
    max_active_trips: String(a.max_active_trips),
  };
}

export type LimitsValidation =
  | { ok: true; values: AgentLimits }
  | { ok: false; errors: Partial<Record<AgentLimitField, string>> };

/** Parse the four form fields; every error is a Hebrew message for that field. */
export function validateAgentLimits(draft: AgentLimitDraft): LimitsValidation {
  const errors: Partial<Record<AgentLimitField, string>> = {};
  const values = {} as AgentLimits;
  for (const field of Object.keys(AGENT_LIMIT_BOUNDS) as AgentLimitField[]) {
    const { max, integer } = AGENT_LIMIT_BOUNDS[field];
    const raw = (draft[field] ?? "").trim();
    if (raw === "") {
      errors[field] = "חובה למלא";
      continue;
    }
    const pattern = integer ? /^\d+$/ : /^\d+(\.\d+)?$/;
    if (!pattern.test(raw)) {
      errors[field] = integer ? "מספר שלם בלבד" : "מספר בלבד, למשל 3 או 2.5";
      continue;
    }
    if (!integer && /\.\d{3,}$/.test(raw)) {
      errors[field] = "עד שתי ספרות אחרי הנקודה";
      continue;
    }
    const n = Number(raw);
    if (n > max) {
      errors[field] = `המקסימום הוא ${max}`;
      continue;
    }
    values[field] = n;
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, values };
}

/** Share of a limit that was used, 0–100. A zero limit with any use counts as full. */
export function usagePercent(used: number, limit: number): number {
  const u = Math.max(0, Number(used) || 0);
  const l = Math.max(0, Number(limit) || 0);
  if (l === 0) return u > 0 ? 100 : 0;
  return Math.min(100, Math.round((u / l) * 100));
}

export type UsageLevel = "ok" | "high" | "full";

/** "high" from 80%, "full" once the limit is reached. */
export function usageLevel(used: number, limit: number): UsageLevel {
  const l = Math.max(0, Number(limit) || 0);
  const u = Math.max(0, Number(used) || 0);
  if (u >= l && (u > 0 || l === 0)) return "full";
  return usagePercent(u, l) >= 80 ? "high" : "ok";
}

/** "$1.20", or "$3" for a whole amount. Starts with an LRM so it reads right inside Hebrew. */
export function formatUsd(n: number): string {
  const v = Math.max(0, Number(n) || 0);
  const s = Number.isInteger(v) ? String(v) : v.toFixed(2);
  return `‎$${s}`;
}

/** "‎$1.20 מתוך ‎$3" */
export function usdOfLimit(used: number, limit: number): string {
  return `${formatUsd(used)} מתוך ${formatUsd(limit)}`;
}

export function agentsCountHe(n: number): string {
  return n === 1 ? "סוכן אחד" : `${n} סוכנים`;
}

export function requestsCountHe(n: number): string {
  return n === 1 ? "בקשה אחת" : `${n} בקשות`;
}

export function groupAgents(rows: AgentAccountUsage[]) {
  return {
    pending: rows.filter((r) => r.status === "pending"),
    active: rows.filter((r) => r.status === "active"),
    suspended: rows.filter((r) => r.status === "suspended"),
  };
}

/** Hebrew toast text for an admin RPC failure (codes raised in migration 022). */
export function adminAgentErrorHe(error: { message?: string; code?: string } | null | undefined): string {
  const msg = error?.message ?? "";
  if (error?.code === "42501" || msg.includes("forbidden")) return "אין לך הרשאת מנהל לפעולה הזו.";
  if (error?.code === "P0002" || msg.includes("agent_request_not_found")) return "הבקשה לא נמצאה. רעננו את הרשימה.";
  if (error?.code === "23514") return "אחת המכסות מחוץ לטווח המותר.";
  return "הפעולה לא הצליחה. נסו שוב.";
}
