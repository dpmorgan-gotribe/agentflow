import { describe, expect, it } from "vitest";
import { BudgetExceededError, BudgetTracker } from "../src/budget-tracker.js";

const defaultCaps = {
  perPipelineMaxUsd: 100,
  perStageMaxUsd: { analyze: 3, mockups: 10 },
};

describe("BudgetTracker — cumulative math", () => {
  it("starts at 0", () => {
    const t = new BudgetTracker(defaultCaps);
    expect(t.getCumulative()).toBe(0);
  });

  it("sums recorded costs", () => {
    const t = new BudgetTracker(defaultCaps);
    t.record(1.5);
    t.record(2.25);
    t.record(0.3);
    expect(t.getCumulative()).toBeCloseTo(4.05, 4);
  });

  it("accepts zero-cost records (cached / dry-run)", () => {
    const t = new BudgetTracker(defaultCaps);
    t.record(0);
    expect(t.getCumulative()).toBe(0);
  });

  it("rejects negative cost", () => {
    const t = new BudgetTracker(defaultCaps);
    expect(() => t.record(-0.01)).toThrow(RangeError);
  });
});

describe("BudgetTracker — cap lookups", () => {
  it("exposes perPipelineMaxUsd", () => {
    const t = new BudgetTracker(defaultCaps);
    expect(t.getPipelineCap()).toBe(100);
  });

  it("returns per-stage cap when configured", () => {
    const t = new BudgetTracker(defaultCaps);
    expect(t.getStageCap("analyze")).toBe(3);
    expect(t.getStageCap("mockups")).toBe(10);
  });

  it("returns undefined for unconfigured stage", () => {
    const t = new BudgetTracker(defaultCaps);
    expect(t.getStageCap("no-such-stage")).toBeUndefined();
  });
});

describe("BudgetTracker — assertUnderBudget", () => {
  it("passes when projected + cumulative ≤ cap", () => {
    const t = new BudgetTracker(defaultCaps);
    t.record(40);
    expect(() => t.assertUnderBudget(60)).not.toThrow(); // exactly at cap
  });

  it("throws BudgetExceededError when projected + cumulative > cap", () => {
    const t = new BudgetTracker(defaultCaps);
    t.record(40);
    expect(() => t.assertUnderBudget(60.01)).toThrow(BudgetExceededError);
  });

  it("error carries cumulative + projected + cap fields", () => {
    const t = new BudgetTracker(defaultCaps);
    t.record(95);
    try {
      t.assertUnderBudget(10);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(BudgetExceededError);
      const e = err as BudgetExceededError;
      expect(e.cumulative).toBe(95);
      expect(e.projected).toBe(10);
      expect(e.cap).toBe(100);
    }
  });

  it("rejects negative projected", () => {
    const t = new BudgetTracker(defaultCaps);
    expect(() => t.assertUnderBudget(-1)).toThrow(RangeError);
  });
});

describe("BudgetTracker — exhausted()", () => {
  it("returns false while under cap", () => {
    const t = new BudgetTracker(defaultCaps);
    t.record(99.99);
    expect(t.exhausted()).toBe(false);
  });

  it("returns true when cumulative reaches cap exactly", () => {
    const t = new BudgetTracker(defaultCaps);
    t.record(100);
    expect(t.exhausted()).toBe(true);
  });

  it("returns true when cumulative exceeds cap (after record past the line)", () => {
    const t = new BudgetTracker(defaultCaps);
    t.record(100.01);
    expect(t.exhausted()).toBe(true);
  });
});

describe("BudgetTracker — persistence round-trip", () => {
  it("toJSON() returns only cumulative (caps are static)", () => {
    const t = new BudgetTracker(defaultCaps);
    t.record(12.34);
    expect(t.toJSON()).toEqual({ cumulativeUsd: 12.34 });
  });

  it("restoreCumulative() replaces cumulative for crash-recovery", () => {
    const t = new BudgetTracker(defaultCaps);
    t.record(5);
    t.restoreCumulative(42);
    expect(t.getCumulative()).toBe(42);
  });

  it("restoreCumulative rejects negative", () => {
    const t = new BudgetTracker(defaultCaps);
    expect(() => t.restoreCumulative(-1)).toThrow(RangeError);
  });
});
