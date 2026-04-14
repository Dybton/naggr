import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { logFood, type LogFoodInput } from "../../src/tools/logFood.js";
import { readDaily, ensureDaily } from "../../src/storage/daily.js";
import { removeProjectFile } from "../helpers.js";

let testDate: string;
let counter = 0;

// We can't easily inject the date into logFood since it uses readDaily() with no args (today).
// Instead, we'll test the tool function indirectly by verifying it returns correct JSON structure.
// For file-level integration, we rely on the daily.test.ts tests.

describe("logFood tool", () => {
  // Note: logFood writes to "today's" file. We test the return value structure
  // and defer file-write correctness to the daily storage tests.

  it("returns correct JSON for a single meal", () => {
    const input: LogFoodInput = {
      meals: [
        {
          meal_type: "Lunch",
          time: "12:30",
          items: [
            { name: "chicken breast", kcal: 300, protein: 50, carbs: 5, fat: 8 },
            { name: "rice", kcal: 200, protein: 5, carbs: 45, fat: 1 },
          ],
          reported: "chicken and rice",
        },
      ],
    };

    const result = JSON.parse(logFood(input));
    expect(result.logged).toHaveLength(1);
    expect(result.logged[0]).toContain("Lunch");
    expect(result.logged[0]).toContain("500 kcal");
    expect(result.logged[0]).toContain("55g protein");
    expect(result.target).toEqual({ kcal: 3500, protein: 180 });
    expect(result.running_totals).toBeDefined();
  });

  it("sums items correctly for a single meal", () => {
    const input: LogFoodInput = {
      meals: [
        {
          meal_type: "Breakfast",
          time: "08:00",
          items: [
            { name: "egg", kcal: 78, protein: 6, carbs: 1, fat: 5 },
            { name: "egg", kcal: 78, protein: 6, carbs: 1, fat: 5 },
            { name: "egg", kcal: 78, protein: 6, carbs: 1, fat: 5 },
          ],
          reported: "3 eggs",
        },
      ],
    };

    const result = JSON.parse(logFood(input));
    expect(result.logged[0]).toContain("234 kcal");
    expect(result.logged[0]).toContain("18g protein");
  });

  it("handles batch meals (breakfast + lunch + dinner)", () => {
    const input: LogFoodInput = {
      meals: [
        {
          meal_type: "Breakfast",
          time: "08:00",
          items: [{ name: "oatmeal", kcal: 300, protein: 10, carbs: 50, fat: 5 }],
          reported: "oatmeal",
        },
        {
          meal_type: "Lunch",
          time: "12:30",
          items: [{ name: "sandwich", kcal: 500, protein: 25, carbs: 40, fat: 20 }],
          reported: "sandwich",
        },
        {
          meal_type: "Dinner",
          time: "18:00",
          items: [{ name: "pasta", kcal: 700, protein: 30, carbs: 80, fat: 15 }],
          reported: "pasta",
        },
      ],
    };

    const result = JSON.parse(logFood(input));
    expect(result.logged).toHaveLength(3);
    expect(result.logged[0]).toContain("Breakfast");
    expect(result.logged[1]).toContain("Lunch");
    expect(result.logged[2]).toContain("Dinner");
  });

  it("includes running totals in response", () => {
    const input: LogFoodInput = {
      meals: [
        {
          meal_type: "Snack",
          time: "15:00",
          items: [{ name: "banana", kcal: 100, protein: 1, carbs: 25, fat: 0 }],
          reported: "banana",
        },
      ],
    };

    const result = JSON.parse(logFood(input));
    expect(typeof result.running_totals.kcal).toBe("number");
    expect(typeof result.running_totals.protein).toBe("number");
  });
});
