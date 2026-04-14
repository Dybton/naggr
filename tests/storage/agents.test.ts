import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  readAgents,
  condensedAgents,
  updateAgentsField,
} from "../../src/storage/agents.js";
import { backupFile, writeFixture, readProjectFile, readFixture } from "../helpers.js";

describe("agents storage", () => {
  let restore: () => void;

  beforeEach(() => {
    restore = backupFile("AGENTS.md");
    // Ensure the fixture is in place
    writeFixture("AGENTS.md", readFixture("agents.md"));
  });

  afterEach(() => {
    restore();
  });

  describe("readAgents", () => {
    it("parses all 5 learned patterns", () => {
      const a = readAgents();
      expect(a.learnedPatterns).toHaveLength(5);
      expect(a.learnedPatterns[0]).toContain("breakfast between 07:30-08:30");
    });

    it("parses supplement streak", () => {
      const a = readAgents();
      expect(a.supplementStreak.days).toBe(1);
      expect(a.supplementStreak.lastDate).toBe("2026-04-05");
    });

    it("parses food logging streak", () => {
      const a = readAgents();
      expect(a.foodStreak.days).toBe(1);
      expect(a.foodStreak.lastDate).toBe("2026-04-05");
    });

    it("parses missed reminders count", () => {
      const a = readAgents();
      expect(a.missedReminders).toBe(2);
    });

    it("parses tapering level", () => {
      const a = readAgents();
      expect(a.taperingLevel).toBe("soft");
    });

    it("preserves raw content", () => {
      const a = readAgents();
      expect(a.raw).toContain("# AGENTS.md");
      expect(a.raw).toContain("### Learned Patterns");
    });
  });

  describe("condensedAgents", () => {
    it("produces a compact summary", () => {
      const a = readAgents();
      const condensed = condensedAgents(a);
      expect(condensed).toContain("supplements 1d");
      expect(condensed).toContain("food logging 1d");
      expect(condensed).toContain("Missed reminders: 2");
      expect(condensed).toContain("Tapering: soft");
    });

    it("includes learned patterns", () => {
      const a = readAgents();
      const condensed = condensedAgents(a);
      expect(condensed).toContain("breakfast between 07:30-08:30");
      expect(condensed).toContain("Green shake");
    });
  });

  describe("updateAgentsField", () => {
    it("updates supplement streak", () => {
      updateAgentsField(
        "supplementStreak",
        "2 days (all 7 supplements taken 2026-04-06)"
      );
      const a = readAgents();
      expect(a.supplementStreak.days).toBe(2);
      expect(a.supplementStreak.lastDate).toBe("2026-04-06");
    });

    it("updates food streak", () => {
      updateAgentsField(
        "foodStreak",
        "3 days (4 meals logged 2026-04-06)"
      );
      const a = readAgents();
      expect(a.foodStreak.days).toBe(3);
    });

    it("updates missed reminders", () => {
      updateAgentsField("missedReminders", "0");
      const a = readAgents();
      expect(a.missedReminders).toBe(0);
    });

    it("updates tapering level", () => {
      updateAgentsField("taperingLevel", 'normal ("standard" tone)');
      const a = readAgents();
      expect(a.taperingLevel).toBe("normal");
    });

    it("adds a learned pattern", () => {
      updateAgentsField(
        "learnedPattern",
        "Jakob likes oatmeal on rest days"
      );
      const a = readAgents();
      expect(a.learnedPatterns).toContain(
        "Jakob likes oatmeal on rest days"
      );
      // Original patterns still present
      expect(a.learnedPatterns.length).toBeGreaterThanOrEqual(6);
    });

    it("does not corrupt unrelated sections", () => {
      updateAgentsField("missedReminders", "5");
      const raw = readProjectFile("AGENTS.md");
      expect(raw).toContain("### Learned Patterns");
      expect(raw).toContain("### Current Streak");
      expect(raw).toContain("## Memory");
    });
  });
});
