// The AI spend caps, shared by the `ask` and `generate` Edge Functions (Deno) and unit-tested
// from src (Vitest). Pure: each function reads the day's numbers through the caller's own
// JWT (the RPCs named below) and this decides. Every spend is a UTC day of agent_runs.
//
// Order matters. The app pool comes first and fails closed: it is the last line of defence
// for the single ANTHROPIC_API_KEY. Then the private pool (030): everyone who isn't an active
// travel agent shares $5 of the $15, so a busy day of private and demo users can never stop
// AI for the agencies, who always keep at least $10.

/** Per signed-up user per day (my_agent_daily_cost_usd). */
export const DAILY_CAP_USD = 2.0;
/** The whole app per day (app_agent_daily_cost_usd, 014). */
export const APP_DAILY_CAP_USD = 15.0;
/** Per "try it yourself" visitor per day (016): a taste, not a free tier. */
export const DEMO_DAILY_CAP_USD = 0.1;
/** All anonymous visitors together per day (anon_agent_daily_cost_usd, 016). */
export const DEMO_APP_DAILY_CAP_USD = 1.0;
/** Everyone who isn't an active agent, demo visitors included, per day (private_daily_cost_usd, 030). */
export const PRIVATE_APP_DAILY_CAP_USD = 5.0;

/** One RPC result as supabase-js returns it. */
export type RpcResult<T> = { data: T | null | undefined; error: unknown };

/** An active agent's own budget (my_agent_limits, 022), or null for everyone else. */
export type AgentBudget = { ai_daily_usd: number | string; ai_monthly_usd: number | string; month_cost_usd: number | string };

export type CapReadings = {
  isAnonymous: boolean;
  mine: RpcResult<number | string>;
  app: RpcResult<number | string>;
  /** Anonymous callers only; anything for the rest. */
  demo: RpcResult<number | string>;
  privatePool: RpcResult<number | string>;
  /** Signed-up callers only; null data for anonymous ones. */
  agent: RpcResult<AgentBudget>;
};

/** A spend as a number; anything unreadable counts as over every cap. */
function spend(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : Infinity;
}

/**
 * Which cap stops this call: "month" for an agent's own monthly budget, "day" for every
 * other (and every unreadable) case, null when the call may go ahead.
 */
export function capVerdict(r: CapReadings): "day" | "month" | null {
  if (r.app.error || spend(r.app.data) >= APP_DAILY_CAP_USD) return "day";
  // An unreadable personal spend counts as reached, for every kind of caller.
  if (r.mine.error) return "day";
  const mine = spend(r.mine.data);

  if (r.isAnonymous) {
    if (r.demo.error || r.privatePool.error) return "day";
    return mine >= DEMO_DAILY_CAP_USD ||
      spend(r.demo.data) >= DEMO_APP_DAILY_CAP_USD ||
      spend(r.privatePool.data) >= PRIVATE_APP_DAILY_CAP_USD
      ? "day"
      : null;
  }

  // Can't tell whether the caller is an agent, or can't read an agent's spend: fail closed.
  if (r.agent.error) return "day";
  if (r.agent.data) {
    // The month goes first: it won't clear tomorrow, and the message has to say so.
    if (!(Number(r.agent.data.ai_monthly_usd) > Number(r.agent.data.month_cost_usd))) return "month";
    return !(Number(r.agent.data.ai_daily_usd) > mine) ? "day" : null;
  }

  // A private account: the shared private pool, then their own day.
  if (r.privatePool.error || spend(r.privatePool.data) >= PRIVATE_APP_DAILY_CAP_USD) return "day";
  return mine >= DAILY_CAP_USD ? "day" : null;
}
