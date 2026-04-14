import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { backupFile, readProjectFile } from "../helpers.js";

// Mock the Anthropic SDK so readProtocol doesn't make real API calls
vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages = {
        create: vi.fn().mockResolvedValue({
          content: [
            {
              type: "text",
              text: JSON.stringify({
                name: "Jakob",
                identity: "I'm someone who shows up for my health every day",
                primaryGoal: "Maintain strength and nutrition through chemo treatment",
                dailyKcal: 3500,
                proteinTarget: 180,
                supplements: [
                  { name: "Vitamin D3", dose: "5000 IU x3", when: "Morning", anchor: "With breakfast" },
                  { name: "Magnesium glycinate", dose: "(dose?)", when: "Morning + Evening (21:00)", anchor: "Morning routine + wind-down" },
                  { name: "Zinc", dose: "(dose?)", when: "Morning", anchor: "With breakfast" },
                  { name: "Omega-3", dose: "included in morning shake", when: "Morning", anchor: "Part of daily shake" },
                  { name: "Melatonin", dose: "(dose?)", when: "30 min before bed", anchor: "Pre-sleep routine" },
                  { name: "Chemo (infusion)", dose: "(dose?)", when: "Biweekly, Wednesdays", anchor: "As prescribed" },
                ],
                reminders: [
                  { time: "07:30", what: "Morning supplements", taper: "Yes, after 14-day streak" },
                  { time: "12:30", what: 'Lunch check-in ("what did you have?")', taper: "Yes" },
                  { time: "18:00", what: "Dinner check-in", taper: "Yes" },
                  { time: "21:00", what: "Chemo + magnesium", taper: "No" },
                  { time: "22:30", what: "Still up? Gentle nudge", taper: "No" },
                ],
                bedtime: "22:00",
                windDownStart: "21:00",
              }),
            },
          ],
        }),
      };
    },
  };
});

import { readProtocol, condensedProtocol, writeProtocol } from "../../src/storage/protocol.js";

describe("protocol storage", () => {
  let restore: () => void;

  beforeEach(() => {
    restore = backupFile("protocol.md");
  });

  afterEach(() => {
    restore();
  });

  describe("readProtocol", () => {
    it("parses all 6 supplements with name, dose, when, anchor", async () => {
      const p = await readProtocol();
      expect(p.supplements).toHaveLength(6);
      expect(p.supplements[0]).toEqual({
        name: "Vitamin D3",
        dose: "5000 IU x3",
        when: "Morning",
        anchor: "With breakfast",
      });
    });

    it("preserves '(dose?)' fields", async () => {
      const p = await readProtocol();
      const mag = p.supplements.find((s) => s.name === "Magnesium glycinate");
      expect(mag?.dose).toBe("(dose?)");
    });

    it("parses all 5 reminder rows with time, what, taper", async () => {
      const p = await readProtocol();
      expect(p.reminders).toHaveLength(5);
      expect(p.reminders[0]).toEqual({
        time: "07:30",
        what: "Morning supplements",
        taper: "Yes, after 14-day streak",
      });
      expect(p.reminders[3]).toEqual({
        time: "21:00",
        what: "Chemo + magnesium",
        taper: "No",
      });
    });

    it("parses diet targets", async () => {
      const p = await readProtocol();
      expect(p.dailyKcal).toBe(3500);
      expect(p.proteinTarget).toBe(180);
    });

    it("parses sleep config", async () => {
      const p = await readProtocol();
      expect(p.bedtime).toBe("22:00");
      expect(p.windDownStart).toBe("21:00");
    });

    it("preserves raw content from the file", async () => {
      const p = await readProtocol();
      expect(p.raw).toContain("# Protocol");
      expect(p.raw).toContain("## Supplements & Medication");
    });
  });

  describe("condensedProtocol", () => {
    it("produces a compact string under ~400 tokens", async () => {
      const p = await readProtocol();
      const condensed = condensedProtocol(p);
      // Rough token estimate: ~4 chars per token
      expect(condensed.length).toBeLessThan(1600);
      expect(condensed).toContain("3500 kcal");
      expect(condensed).toContain("180g protein");
      expect(condensed).toContain("Vitamin D3");
    });

    it("includes all supplements", async () => {
      const p = await readProtocol();
      const condensed = condensedProtocol(p);
      expect(condensed).toContain("Magnesium glycinate");
      expect(condensed).toContain("Zinc");
      expect(condensed).toContain("Omega-3");
      expect(condensed).toContain("Melatonin");
      expect(condensed).toContain("Chemo (infusion)");
    });
  });

  describe("writeProtocol (surgical edit)", () => {
    it("changes reminder time in the raw file", () => {
      const original = readProjectFile("protocol.md");
      const updated = original.replace("| 21:00 |", "| 20:30 |");
      writeProtocol(updated);

      const written = readProjectFile("protocol.md");
      expect(written).toContain("| 20:30 |");
      expect(written).toContain("| 07:30 |"); // other reminders unchanged
    });

    it("changes calorie target in the raw file", () => {
      const original = readProjectFile("protocol.md");
      const updated = original.replace(
        "Daily target: 3500 kcal",
        "Daily target: 3000 kcal"
      );
      writeProtocol(updated);

      const written = readProjectFile("protocol.md");
      expect(written).toContain("Daily target: 3000 kcal");
      // Protein unchanged
      expect(written).toContain("Protein target: 180g");
    });
  });
});
