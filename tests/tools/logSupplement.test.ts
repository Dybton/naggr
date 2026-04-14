import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { logSupplement, type LogSupplementInput } from "../../src/tools/logSupplement.js";
import { readDaily, ensureDaily, dailyPath } from "../../src/storage/daily.js";
import { backupFile, removeProjectFile } from "../helpers.js";
import { existsSync, unlinkSync } from "fs";

// logSupplement operates on today's file, so we must back it up/restore
describe("logSupplement tool", () => {
  let restore: (() => void) | null = null;

  beforeEach(() => {
    // Get today's date string the same way daily.ts does
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Copenhagen" });
    restore = backupFile(`daily/${today}.md`);
    // Delete any existing file so ensureDaily creates a fresh blank one
    const path = dailyPath();
    if (existsSync(path)) unlinkSync(path);
    ensureDaily();
  });

  afterEach(() => {
    restore?.();
  });

  it("marks a single supplement and returns correct counts", () => {
    const input: LogSupplementInput = {
      names: ["Omega-3"],
      time: "08:15",
    };

    const result = JSON.parse(logSupplement(input));
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toContain("marked");
    expect(result.supplements_total).toBe(6);
    expect(result.supplements_taken).toBeGreaterThanOrEqual(1);
  });

  it("marks multiple supplements in one call", () => {
    const input: LogSupplementInput = {
      names: ["Vitamin D3", "Zinc"],
      time: "08:20",
    };

    const result = JSON.parse(logSupplement(input));
    expect(result.results).toHaveLength(2);
  });

  it("reports 'not found' for non-existent supplement", () => {
    const input: LogSupplementInput = {
      names: ["Vitamin B12"],
      time: "08:00",
    };

    const result = JSON.parse(logSupplement(input));
    expect(result.results[0]).toContain("not found");
  });

  it("reports 'already done' for already-checked supplement", () => {
    // Mark once
    logSupplement({ names: ["Melatonin"], time: "22:00" });
    // Mark again
    const result = JSON.parse(
      logSupplement({ names: ["Melatonin"], time: "22:30" })
    );
    expect(result.results[0]).toContain("not found or already done");
  });
});
