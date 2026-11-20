import { describe, expect, it } from "vitest";
import {
  APP_DAILY_CAP_USD,
  capVerdict,
  DAILY_CAP_USD,
  DEMO_APP_DAILY_CAP_USD,
  DEMO_DAILY_CAP_USD,
  PRIVATE_APP_DAILY_CAP_USD,
  type CapReadings,
} from "../../supabase/functions/_shared/ai-caps";

const ok = <T>(data: T) => ({ data, error: null });
const failed = { data: null, error: { message: "boom" } };
const AGENT = { ai_daily_usd: 3, ai_monthly_usd: 15, month_cost_usd: 1 };

const privateUser = (over: Partial<CapReadings> = {}): CapReadings => ({
  isAnonymous: false,
  mine: ok(0),
  app: ok(0),
  demo: ok(0),
  privatePool: ok(0),
  agent: ok(null),
  ...over,
});
const agent = (over: Partial<CapReadings> = {}): CapReadings => privateUser({ agent: ok(AGENT), ...over });
const demo = (over: Partial<CapReadings> = {}): CapReadings =>
  privateUser({ isAnonymous: true, agent: ok(null), ...over });

describe("capVerdict: the private pool (030)", () => {
  it("stops a private user once private and demo users spent $5 today", () => {
    expect(capVerdict(privateUser({ privatePool: ok(PRIVATE_APP_DAILY_CAP_USD) }))).toBe("day");
    expect(capVerdict(privateUser({ privatePool: ok(PRIVATE_APP_DAILY_CAP_USD - 0.01) }))).toBeNull();
  });
  it("stops a demo visitor too", () => {
    expect(capVerdict(demo({ privatePool: ok(PRIVATE_APP_DAILY_CAP_USD) }))).toBe("day");
  });
  it("never stops an active agent: agencies keep the rest of the app pool", () => {
    expect(capVerdict(agent({ privatePool: ok(PRIVATE_APP_DAILY_CAP_USD + 100), app: ok(APP_DAILY_CAP_USD - 0.01) }))).toBeNull();
    expect(capVerdict(agent({ privatePool: failed }))).toBeNull();
  });
  it("fails closed for private and demo users when the pool can't be read", () => {
    expect(capVerdict(privateUser({ privatePool: failed }))).toBe("day");
    expect(capVerdict(demo({ privatePool: failed }))).toBe("day");
    expect(capVerdict(privateUser({ privatePool: ok("not a number") }))).toBe("day");
  });
});

describe("capVerdict: the caps that were already there", () => {
  it("app pool stops everyone, and fails closed", () => {
    expect(capVerdict(agent({ app: ok(APP_DAILY_CAP_USD) }))).toBe("day");
    expect(capVerdict(privateUser({ app: ok(APP_DAILY_CAP_USD) }))).toBe("day");
    expect(capVerdict(agent({ app: failed }))).toBe("day");
  });
  it("an unreadable personal spend stops everyone", () => {
    expect(capVerdict(agent({ mine: failed }))).toBe("day");
    expect(capVerdict(privateUser({ mine: failed }))).toBe("day");
    expect(capVerdict(demo({ mine: failed }))).toBe("day");
  });
  it("private user: $2 a day", () => {
    expect(capVerdict(privateUser({ mine: ok(DAILY_CAP_USD) }))).toBe("day");
    expect(capVerdict(privateUser({ mine: ok(DAILY_CAP_USD - 0.01) }))).toBeNull();
  });
  it("demo visitor: own $0.10 and the $1 demo pool (now also failing closed)", () => {
    expect(capVerdict(demo({ mine: ok(DEMO_DAILY_CAP_USD) }))).toBe("day");
    expect(capVerdict(demo({ demo: ok(DEMO_APP_DAILY_CAP_USD) }))).toBe("day");
    expect(capVerdict(demo({ demo: failed }))).toBe("day");
    expect(capVerdict(demo())).toBeNull();
  });
  it("agent: own month first, then own day; unreadable agent status fails closed", () => {
    expect(capVerdict(agent({ agent: ok({ ...AGENT, month_cost_usd: 15 }) }))).toBe("month");
    expect(capVerdict(agent({ mine: ok(3) }))).toBe("day");
    expect(capVerdict(agent({ mine: ok(2.99) }))).toBeNull();
    expect(capVerdict(privateUser({ agent: failed }))).toBe("day");
  });
  it("numbers arriving as strings (Postgres NUMERIC) are read as numbers", () => {
    expect(capVerdict(privateUser({ mine: ok("2.00") }))).toBe("day");
    expect(capVerdict(privateUser({ mine: ok("1.99"), privatePool: ok("4.99") }))).toBeNull();
  });
});
