import { describe, it, expect } from "vitest";
import { readStatus } from "../../src/tools/readStatus.js";
import { ensureDaily } from "../../src/storage/daily.js";

describe("readStatus tool", () => {
  it("returns valid JSON with all expected fields", () => {
    ensureDaily();
    const result = JSON.parse(readStatus());

    expect(result).toHaveProperty("date");
    expect(result).toHaveProperty("kcal");
    expect(result).toHaveProperty("kcal_target", 3500);
    expect(result).toHaveProperty("protein");
    expect(result).toHaveProperty("protein_target", 180);
    expect(result).toHaveProperty("meals_logged");
    expect(result).toHaveProperty("supplements_taken");
    expect(result).toHaveProperty("supplements_total");
    expect(result).toHaveProperty("supplements_due");
    expect(result).toHaveProperty("exercise");
    expect(result).toHaveProperty("supplement_streak");
    expect(result).toHaveProperty("food_streak");
    expect(result).toHaveProperty("tapering");
  });

  it("supplements_due lists names of unchecked supplements", () => {
    ensureDaily();
    const result = JSON.parse(readStatus());

    expect(Array.isArray(result.supplements_due)).toBe(true);
    // On a fresh day, all should be due
    if (result.supplements_taken === 0) {
      expect(result.supplements_due.length).toBe(result.supplements_total);
    }
  });

  it("returns numeric types for counts and totals", () => {
    ensureDaily();
    const result = JSON.parse(readStatus());

    expect(typeof result.kcal).toBe("number");
    expect(typeof result.protein).toBe("number");
    expect(typeof result.meals_logged).toBe("number");
    expect(typeof result.supplements_taken).toBe("number");
    expect(typeof result.supplement_streak).toBe("number");
  });
});
