import { describe, expect, it } from "vitest";
// The ask Edge Function's own pricing (plain TS, shared with evals/run.ts).
import { usageCostUsd } from "../../supabase/functions/ask/prompt.ts";

describe("usageCostUsd", () => {
  it("prices plain input and output tokens", () => {
    expect(usageCostUsd({ input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBeCloseTo(0.6);
  });

  // The bug: a follow-up question read its prompt from the cache and was logged at ~0.
  it("counts cache reads and cache writes", () => {
    const plain = usageCostUsd({ input_tokens: 93, output_tokens: 991 });
    const cached = usageCostUsd({ input_tokens: 93, output_tokens: 991, cache_read_input_tokens: 1800 });
    expect(cached).toBeGreaterThan(plain);
    expect(usageCostUsd({ cache_read_input_tokens: 1_000_000 })).toBeCloseTo(0.01);
    expect(usageCostUsd({ cache_creation_input_tokens: 1_000_000 })).toBeCloseTo(0.125);
  });

  it("treats missing or junk fields as zero", () => {
    expect(usageCostUsd({})).toBe(0);
    expect(usageCostUsd({ input_tokens: Number.NaN })).toBe(0);
  });
});
