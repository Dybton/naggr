import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  readDaily,
  ensureDaily,
  appendMeal,
  markSupplement,
  dailyPath,
  type MealEntry,
} from "../../src/storage/daily.js";
import { readFixture, removeProjectFile, readProjectFile } from "../helpers.js";
import { writeFileSync, existsSync } from "fs";

// Use unique test dates to avoid interfering with real data
let testDate: string;
let dateCounter = 0;

function nextTestDate(): string {
  dateCounter++;
  return `9999-12-${String(dateCounter).padStart(2, "0")}`;
}

describe("daily storage", () => {
  beforeEach(() => {
    testDate = nextTestDate();
  });

  afterEach(() => {
    removeProjectFile(`daily/${testDate}.md`);
  });

  describe("ensureDaily", () => {
    it("creates a blank daily file when none exists", () => {
      const path = ensureDaily(testDate);
      expect(existsSync(path)).toBe(true);
      const content = readProjectFile(`daily/${testDate}.md`);
      expect(content).toContain(`# ${testDate}`);
      expect(content).toContain("## Meals");
      expect(content).toContain("## Supplements");
      expect(content).toContain("## Running Totals");
    });

    it("does not overwrite an existing file", () => {
      ensureDaily(testDate);
      // Write something custom
      const path = dailyPath(testDate);
      writeFileSync(path, "custom content", "utf-8");

      ensureDaily(testDate);
      const content = readProjectFile(`daily/${testDate}.md`);
      expect(content).toBe("custom content");
    });
  });

  describe("readDaily - parsing existing file", () => {
    it("parses meals from sample daily file", () => {
      const fixture = readFixture("daily-sample.md").replace(
        "# 2026-04-06",
        `# ${testDate}`
      );
      ensureDaily(testDate);
      writeFileSync(dailyPath(testDate), fixture, "utf-8");

      const daily = readDaily(testDate);
      // Sample has Breakfast (~08:00), Lunch (~13:50), Snack 1 (~18:18) - all with numeric times
      expect(daily.meals).toHaveLength(3);

      const breakfast = daily.meals.find((m) =>
        m.mealType.includes("Breakfast")
      );
      expect(breakfast).toBeDefined();
      expect(breakfast!.kcal).toBe(1050);
      expect(breakfast!.protein).toBe(56);
      expect(breakfast!.carbs).toBe(27);
      expect(breakfast!.fat).toBe(75);
    });

    it("parses lunch correctly", () => {
      const fixture = readFixture("daily-sample.md").replace(
        "# 2026-04-06",
        `# ${testDate}`
      );
      ensureDaily(testDate);
      writeFileSync(dailyPath(testDate), fixture, "utf-8");

      const daily = readDaily(testDate);
      const lunch = daily.meals.find((m) => m.mealType.includes("Lunch"));
      expect(lunch).toBeDefined();
      expect(lunch!.kcal).toBe(650);
      expect(lunch!.protein).toBe(50);
    });

    it("parses all supplement checkboxes as unchecked", () => {
      const fixture = readFixture("daily-sample.md").replace(
        "# 2026-04-06",
        `# ${testDate}`
      );
      ensureDaily(testDate);
      writeFileSync(dailyPath(testDate), fixture, "utf-8");

      const daily = readDaily(testDate);
      expect(daily.supplements).toHaveLength(6);
      expect(daily.supplements.every((s) => !s.done)).toBe(true);
    });

    it("parses supplement names correctly", () => {
      const fixture = readFixture("daily-sample.md").replace(
        "# 2026-04-06",
        `# ${testDate}`
      );
      ensureDaily(testDate);
      writeFileSync(dailyPath(testDate), fixture, "utf-8");

      const daily = readDaily(testDate);
      const names = daily.supplements.map((s) => s.name);
      expect(names).toContain("Omega-3 (with breakfast shake)");
      expect(names).toContain("Vitamin D3 5000 IU x3 (with breakfast)");
      expect(names).toContain("Zinc (morning)");
    });

    it("returns zero totals for a blank daily file", () => {
      ensureDaily(testDate);
      const daily = readDaily(testDate);
      expect(daily.totals).toEqual({ kcal: 0, protein: 0, carbs: 0, fat: 0 });
      expect(daily.meals).toHaveLength(0);
    });
  });

  describe("appendMeal", () => {
    it("adds a new meal entry to the daily file", () => {
      ensureDaily(testDate);

      const meal: MealEntry = {
        mealType: "Lunch",
        time: "12:30",
        reported: "chicken salad",
        kcal: 500,
        protein: 40,
        carbs: 20,
        fat: 15,
      };
      appendMeal(meal, testDate);

      const daily = readDaily(testDate);
      expect(daily.meals).toHaveLength(1);
      expect(daily.meals[0].mealType).toBe("Lunch");
      expect(daily.meals[0].kcal).toBe(500);
    });

    it("recomputes running totals after adding a meal", () => {
      ensureDaily(testDate);

      appendMeal(
        {
          mealType: "Breakfast",
          time: "08:00",
          reported: "eggs",
          kcal: 300,
          protein: 20,
          carbs: 5,
          fat: 15,
        },
        testDate
      );
      appendMeal(
        {
          mealType: "Lunch",
          time: "12:30",
          reported: "salad",
          kcal: 500,
          protein: 30,
          carbs: 40,
          fat: 10,
        },
        testDate
      );

      const daily = readDaily(testDate);
      expect(daily.totals.kcal).toBe(800);
      expect(daily.totals.protein).toBe(50);
      expect(daily.totals.carbs).toBe(45);
      expect(daily.totals.fat).toBe(25);
    });

    it("totals are computed from all meals, not accumulated", () => {
      ensureDaily(testDate);

      appendMeal(
        { mealType: "Breakfast", time: "08:00", reported: "a", kcal: 100, protein: 10, carbs: 5, fat: 5 },
        testDate
      );
      appendMeal(
        { mealType: "Lunch", time: "12:00", reported: "b", kcal: 200, protein: 20, carbs: 10, fat: 10 },
        testDate
      );
      appendMeal(
        { mealType: "Dinner", time: "18:00", reported: "c", kcal: 300, protein: 30, carbs: 15, fat: 15 },
        testDate
      );

      const daily = readDaily(testDate);
      expect(daily.totals.kcal).toBe(600);
      expect(daily.totals.protein).toBe(60);
    });

    it("includes note when provided", () => {
      ensureDaily(testDate);
      appendMeal(
        {
          mealType: "Snack 1",
          time: "15:00",
          reported: "protein bar",
          kcal: 200,
          protein: 20,
          carbs: 25,
          fat: 8,
          note: "Estimated from packaging",
        },
        testDate
      );

      const content = readProjectFile(`daily/${testDate}.md`);
      expect(content).toContain("Note: Estimated from packaging");
    });

    it("handles first meal of the day on blank file", () => {
      ensureDaily(testDate);
      appendMeal(
        { mealType: "Breakfast", time: "08:30", reported: "eggs", kcal: 400, protein: 30, carbs: 5, fat: 25 },
        testDate
      );

      const daily = readDaily(testDate);
      expect(daily.meals).toHaveLength(1);
      expect(daily.totals.kcal).toBe(400);
    });
  });

  describe("markSupplement", () => {
    it("toggles a supplement checkbox to done with timestamp", () => {
      ensureDaily(testDate);
      const result = markSupplement("Omega-3", "08:15", testDate);
      expect(result).toBe(true);

      const daily = readDaily(testDate);
      const omega = daily.supplements.find((s) => s.name.includes("Omega"));
      expect(omega?.done).toBe(true);
      expect(omega?.time).toBe("08:15");
    });

    it("marks multiple supplements independently", () => {
      ensureDaily(testDate);
      markSupplement("Omega-3", "08:15", testDate);
      markSupplement("Vitamin D3", "08:16", testDate);
      markSupplement("Zinc", "08:17", testDate);

      const daily = readDaily(testDate);
      const done = daily.supplements.filter((s) => s.done);
      expect(done.length).toBe(3);
    });

    it("returns false for non-existent supplement", () => {
      ensureDaily(testDate);
      const result = markSupplement("Vitamin B12", "08:00", testDate);
      expect(result).toBe(false);
    });

    it("returns false for already-checked supplement", () => {
      ensureDaily(testDate);
      markSupplement("Omega-3", "08:15", testDate);
      // Second mark should fail because it's now [x] not [ ]
      const result = markSupplement("Omega-3", "08:30", testDate);
      expect(result).toBe(false);
    });

    it("does not corrupt other supplement lines", () => {
      ensureDaily(testDate);
      markSupplement("Zinc", "08:20", testDate);

      const daily = readDaily(testDate);
      const omega = daily.supplements.find((s) => s.name.includes("Omega"));
      expect(omega?.done).toBe(false);
      const melatonin = daily.supplements.find((s) =>
        s.name.includes("Melatonin")
      );
      expect(melatonin?.done).toBe(false);
    });
  });

  describe("multiple meals same type", () => {
    it("allows two lunches in one day", () => {
      ensureDaily(testDate);
      appendMeal(
        { mealType: "Lunch", time: "12:00", reported: "salad", kcal: 300, protein: 20, carbs: 30, fat: 10 },
        testDate
      );
      appendMeal(
        { mealType: "Lunch", time: "13:30", reported: "sandwich", kcal: 400, protein: 25, carbs: 35, fat: 15 },
        testDate
      );

      const daily = readDaily(testDate);
      const lunches = daily.meals.filter((m) => m.mealType === "Lunch");
      expect(lunches).toHaveLength(2);
      expect(daily.totals.kcal).toBe(700);
    });
  });
});
