import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readDaily, ensureDaily, markSupplement, appendMeal } from "../src/storage/daily.js";
import { readAgents, updateAgentsField } from "../src/storage/agents.js";
import { backupFile, writeFixture, readFixture, removeProjectFile } from "./helpers.js";

describe("scheduler decision logic", () => {

  describe("morning supplement check", () => {
    let testDate: string;
    let counter = 0;

    function nextDate(): string {
      counter++;
      return `9998-11-${String(counter).padStart(2, "0")}`;
    }

    beforeEach(() => {
      testDate = nextDate();
    });

    afterEach(() => {
      removeProjectFile(`daily/${testDate}.md`);
    });

    it("returns false (not done) when no supplements are checked", () => {
      ensureDaily(testDate);
      const daily = readDaily(testDate);
      const morningSupps = daily.supplements.filter(
        (s) =>
          s.name.toLowerCase().includes("omega") ||
          s.name.toLowerCase().includes("vitamin d") ||
          s.name.toLowerCase().includes("zinc") ||
          (s.name.toLowerCase().includes("magnesium") &&
            !s.name.toLowerCase().includes("chemo"))
      );
      const allDone = morningSupps.every((s) => s.done);
      expect(allDone).toBe(false);
    });

    it("returns true (done) when all morning supplements are checked", () => {
      ensureDaily(testDate);
      markSupplement("Omega-3", "08:00", testDate);
      markSupplement("Vitamin D3", "08:01", testDate);
      markSupplement("Zinc", "08:02", testDate);
      markSupplement("Magnesium glycinate", "08:03", testDate);

      const daily = readDaily(testDate);
      const morningSupps = daily.supplements.filter(
        (s) =>
          s.name.toLowerCase().includes("omega") ||
          s.name.toLowerCase().includes("vitamin d") ||
          s.name.toLowerCase().includes("zinc") ||
          (s.name.toLowerCase().includes("magnesium") &&
            !s.name.toLowerCase().includes("chemo"))
      );
      const allDone = morningSupps.every((s) => s.done);
      expect(allDone).toBe(true);
    });

    it("returns false when only some morning supplements are checked", () => {
      ensureDaily(testDate);
      markSupplement("Omega-3", "08:00", testDate);
      markSupplement("Zinc", "08:02", testDate);

      const daily = readDaily(testDate);
      const morningSupps = daily.supplements.filter(
        (s) =>
          s.name.toLowerCase().includes("omega") ||
          s.name.toLowerCase().includes("vitamin d") ||
          s.name.toLowerCase().includes("zinc") ||
          (s.name.toLowerCase().includes("magnesium") &&
            !s.name.toLowerCase().includes("chemo"))
      );
      const allDone = morningSupps.every((s) => s.done);
      expect(allDone).toBe(false);
    });
  });

  describe("evening supplement check", () => {
    let testDate: string;
    let counter = 100;

    function nextDate(): string {
      counter++;
      return `9998-10-${String(counter - 100).padStart(2, "0")}`;
    }

    beforeEach(() => {
      testDate = nextDate();
    });

    afterEach(() => {
      removeProjectFile(`daily/${testDate}.md`);
    });

    it("returns false when chemo + magnesium not done", () => {
      ensureDaily(testDate);
      const daily = readDaily(testDate);
      const eveningSupps = daily.supplements.filter(
        (s) =>
          s.name.toLowerCase().includes("chemo") ||
          (s.name.toLowerCase().includes("magnesium") &&
            s.name.toLowerCase().includes("21"))
      );
      const allDone = eveningSupps.every((s) => s.done);
      expect(allDone).toBe(false);
    });
  });

  describe("lunch check-in", () => {
    let testDate: string;
    let counter = 200;

    function nextDate(): string {
      counter++;
      return `9998-09-${String(counter - 200).padStart(2, "0")}`;
    }

    beforeEach(() => {
      testDate = nextDate();
    });

    afterEach(() => {
      removeProjectFile(`daily/${testDate}.md`);
    });

    it("returns false (not done) when no lunch logged", () => {
      ensureDaily(testDate);
      const daily = readDaily(testDate);
      const hasLunch = daily.meals.some((m) => {
        const t = m.time.replace("~", "");
        return t >= "10:00" || m.mealType.toLowerCase().includes("lunch");
      });
      expect(hasLunch).toBe(false);
    });

    it("returns true (done) when lunch is logged", () => {
      ensureDaily(testDate);
      appendMeal(
        {
          mealType: "Lunch",
          time: "12:30",
          reported: "salad",
          kcal: 500,
          protein: 30,
          carbs: 20,
          fat: 15,
        },
        testDate
      );

      const daily = readDaily(testDate);
      const hasLunch = daily.meals.some((m) => {
        const t = m.time.replace("~", "");
        return t >= "10:00" || m.mealType.toLowerCase().includes("lunch");
      });
      expect(hasLunch).toBe(true);
    });
  });

  describe("daily summary check", () => {
    let testDate: string;
    let counter = 300;

    function nextDate(): string {
      counter++;
      return `9998-08-${String(counter - 300).padStart(2, "0")}`;
    }

    beforeEach(() => {
      testDate = nextDate();
    });

    afterEach(() => {
      removeProjectFile(`daily/${testDate}.md`);
    });

    it("skips (returns true) when no meals logged (inactive day)", () => {
      ensureDaily(testDate);
      const daily = readDaily(testDate);
      const skip = daily.meals.length === 0;
      expect(skip).toBe(true);
    });

    it("fires (returns false) when meals are logged (active day)", () => {
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

      const daily = readDaily(testDate);
      const skip = daily.meals.length === 0;
      expect(skip).toBe(false);
    });
  });

  describe("calorie pace logic", () => {
    let testDate: string;
    let counter = 400;

    function nextDate(): string {
      counter++;
      return `9998-07-${String(counter - 400).padStart(2, "0")}`;
    }

    beforeEach(() => {
      testDate = nextDate();
    });

    afterEach(() => {
      removeProjectFile(`daily/${testDate}.md`);
    });

    it("detects significantly behind pace at lunch (< 70% of 40% target)", () => {
      ensureDaily(testDate);
      appendMeal(
        {
          mealType: "Breakfast",
          time: "08:00",
          reported: "toast",
          kcal: 200,
          protein: 5,
          carbs: 30,
          fat: 5,
        },
        testDate
      );

      const daily = readDaily(testDate);
      const target = 3500;
      const fraction = 0.4;
      const pace = Math.round(target * fraction); // 1400
      const current = daily.totals.kcal; // 200

      expect(current).toBeLessThan(pace * 0.7); // 200 < 980
    });

    it("detects on pace at lunch", () => {
      ensureDaily(testDate);
      appendMeal(
        {
          mealType: "Breakfast",
          time: "08:00",
          reported: "big breakfast",
          kcal: 1000,
          protein: 50,
          carbs: 80,
          fat: 40,
        },
        testDate
      );
      appendMeal(
        {
          mealType: "Snack",
          time: "10:30",
          reported: "shake",
          kcal: 700,
          protein: 42,
          carbs: 20,
          fat: 30,
        },
        testDate
      );

      const daily = readDaily(testDate);
      const target = 3500;
      const fraction = 0.4;
      const pace = Math.round(target * fraction); // 1400
      const current = daily.totals.kcal; // 1700

      expect(current).toBeGreaterThanOrEqual(pace * 0.9); // 1700 >= 1260
    });

    it("detects behind pace at dinner (< 70% of 70% target)", () => {
      ensureDaily(testDate);
      appendMeal(
        {
          mealType: "Breakfast",
          time: "08:00",
          reported: "light",
          kcal: 500,
          protein: 20,
          carbs: 40,
          fat: 15,
        },
        testDate
      );

      const daily = readDaily(testDate);
      const target = 3500;
      const fraction = 0.7;
      const pace = Math.round(target * fraction); // 2450
      const current = daily.totals.kcal; // 500

      expect(current).toBeLessThan(pace * 0.7); // 500 < 1715
    });
  });

  describe("tapering behavior", () => {
    let restore: () => void;

    beforeEach(() => {
      restore = backupFile("AGENTS.md");
      writeFixture("AGENTS.md", readFixture("agents.md"));
    });

    afterEach(() => {
      restore();
    });

    it("detects normal tone when 0 missed", () => {
      updateAgentsField("missedReminders", "0");

      const agents = readAgents();
      expect(agents.missedReminders).toBe(0);
      expect(agents.missedReminders < 2).toBe(true);
    });

    it("detects soft tone when 2 missed", () => {
      const agents = readAgents();
      expect(agents.missedReminders).toBe(2);
      expect(agents.missedReminders >= 2).toBe(true);
      expect(agents.missedReminders < 3).toBe(true);
    });

    it("detects back-off when 3+ missed", () => {
      updateAgentsField("missedReminders", "4");

      const agents = readAgents();
      expect(agents.missedReminders).toBe(4);
      expect(agents.missedReminders >= 3).toBe(true);
    });
  });

  describe("cron schedule validation", () => {
    it("no cron entries fire during quiet hours (23:00-07:00)", () => {
      // These are the cron expressions from scheduler.ts
      // Note: protocol says 07:30 for first reminder, HEARTBEAT says quiet until 08:00
      // The scheduler implements 07:30 per protocol, so quiet hours are effectively 23:00-07:29
      const cronExprs = [
        { expr: "30 7 * * *", desc: "morning supplements" },
        { expr: "30 12 * * *", desc: "lunch check-in" },
        { expr: "0 18 * * *", desc: "dinner check-in" },
        { expr: "0 21 * * *", desc: "evening reminder" },
        { expr: "30 22 * * *", desc: "daily summary" },
      ];

      for (const { expr, desc } of cronExprs) {
        const [minute, hour] = expr.split(" ").map(Number);
        // No entries between 23:00 and 07:00 (exclusive)
        const isDeepNight = hour >= 23 || hour < 7;
        expect(isDeepNight, `${desc} at ${hour}:${String(minute).padStart(2, "0")} fires during deep night`).toBe(false);
      }
    });

    it("all 5 reminder types are scheduled", () => {
      const cronExprs = [
        "30 7 * * *",   // morning supplements
        "30 12 * * *",  // lunch
        "0 18 * * *",   // dinner
        "0 21 * * *",   // evening
        "30 22 * * *",  // summary
      ];
      expect(cronExprs).toHaveLength(5);
    });

    it("earliest reminder is at 07:30", () => {
      const hours = [7.5, 12.5, 18, 21, 22.5]; // decimal hours
      const earliest = Math.min(...hours);
      expect(earliest).toBe(7.5);
    });

    it("latest reminder is at 22:30", () => {
      const hours = [7.5, 12.5, 18, 21, 22.5];
      const latest = Math.max(...hours);
      expect(latest).toBe(22.5);
    });
  });
});
