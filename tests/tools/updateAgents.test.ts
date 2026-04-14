import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { updateAgents, type UpdateAgentsInput } from "../../src/tools/updateAgents.js";
import { readAgents } from "../../src/storage/agents.js";
import { backupFile, writeFixture, readFixture } from "../helpers.js";

describe("updateAgents tool", () => {
  let restore: () => void;

  beforeEach(() => {
    restore = backupFile("AGENTS.md");
    writeFixture("AGENTS.md", readFixture("agents.md"));
  });

  afterEach(() => {
    restore();
  });

  it("patches supplement streak", () => {
    const input: UpdateAgentsInput = {
      field: "supplementStreak",
      value: "5 days (all supplements taken 2026-04-10)",
    };

    const result = JSON.parse(updateAgents(input));
    expect(result.success).toBe(true);

    const a = readAgents();
    expect(a.supplementStreak.days).toBe(5);
  });

  it("changes tapering level", () => {
    const input: UpdateAgentsInput = {
      field: "taperingLevel",
      value: 'normal ("standard" tone)',
    };

    const result = JSON.parse(updateAgents(input));
    expect(result.success).toBe(true);

    const a = readAgents();
    expect(a.taperingLevel).toBe("normal");
  });

  it("adds a new learned pattern", () => {
    const input: UpdateAgentsInput = {
      field: "learnedPattern",
      value: "Jakob prefers scrambled over fried eggs",
    };

    const result = JSON.parse(updateAgents(input));
    expect(result.success).toBe(true);

    const a = readAgents();
    expect(a.learnedPatterns).toContain(
      "Jakob prefers scrambled over fried eggs"
    );
  });

  it("resets missed reminders to zero", () => {
    const input: UpdateAgentsInput = {
      field: "missedReminders",
      value: "0",
    };

    updateAgents(input);
    const a = readAgents();
    expect(a.missedReminders).toBe(0);
  });
});
