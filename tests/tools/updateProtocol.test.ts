import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { updateProtocol, type UpdateProtocolInput } from "../../src/tools/updateProtocol.js";
import { backupFile, readProjectFile } from "../helpers.js";

describe("updateProtocol tool", () => {
  let restore: () => void;

  beforeEach(() => {
    restore = backupFile("protocol.md");
  });

  afterEach(() => {
    restore();
  });

  it("changes a value via find-and-replace", () => {
    // Read the actual file to find a real string to replace
    const content = readProjectFile("protocol.md");
    // Find the protein target line
    expect(content).toContain("Protein target: 180g");

    const input: UpdateProtocolInput = {
      section: "Diet",
      old_text: "Protein target: 180g",
      new_text: "Protein target: 200g",
    };

    const result = JSON.parse(updateProtocol(input));
    expect(result.success).toBe(true);

    const updated = readProjectFile("protocol.md");
    expect(updated).toContain("Protein target: 200g");
  });

  it("changes calorie target", () => {
    const input: UpdateProtocolInput = {
      section: "Diet",
      old_text: "Daily target: 3500 kcal",
      new_text: "Daily target: 3000 kcal",
    };

    const result = JSON.parse(updateProtocol(input));
    expect(result.success).toBe(true);

    const content = readProjectFile("protocol.md");
    expect(content).toContain("Daily target: 3000 kcal");
  });

  it("fails gracefully when text not found", () => {
    const input: UpdateProtocolInput = {
      section: "Diet",
      old_text: "This text does not exist anywhere",
      new_text: "replacement",
    };

    const result = JSON.parse(updateProtocol(input));
    expect(result.success).toBe(false);
    expect(result.error).toContain("Could not find");
  });

  it("does not modify other sections", () => {
    const input: UpdateProtocolInput = {
      section: "Diet",
      old_text: "Protein target: 180g",
      new_text: "Protein target: 200g",
    };
    updateProtocol(input);

    const updated = readProjectFile("protocol.md");
    expect(updated).toContain("Protein target: 200g");
    expect(updated).toContain("Daily target: 3500 kcal");
    expect(updated).toContain("Vitamin D3 | 5000 IU x3");
  });

  it("adds a new supplement row", () => {
    const input: UpdateProtocolInput = {
      section: "Supplements",
      old_text: "| Chemo (infusion) | (dose?) | Biweekly, Wednesdays | As prescribed |",
      new_text:
        "| Chemo (infusion) | (dose?) | Biweekly, Wednesdays | As prescribed |\n| Creatine | 5g | Morning | With breakfast shake |",
    };

    const result = JSON.parse(updateProtocol(input));
    expect(result.success).toBe(true);

    const content = readProjectFile("protocol.md");
    expect(content).toContain("Creatine | 5g | Morning");
  });
});
