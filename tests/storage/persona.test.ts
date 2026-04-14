import { describe, it, expect } from "vitest";
import { loadSoul } from "../../src/storage/persona.js";

describe("persona storage", () => {
  it("loads SOUL.md content", () => {
    const soul = loadSoul();
    expect(soul).toContain("# Naggr");
    expect(soul).toContain("warm, slightly wry health coach");
  });

  it("contains core personality section", () => {
    const soul = loadSoul();
    expect(soul).toContain("## Core personality");
    expect(soul).toContain("COACH, not a doctor");
  });

  it("contains communication rules", () => {
    const soul = loadSoul();
    expect(soul).toContain("## Communication rules");
    expect(soul).toContain("1-3 sentences");
  });

  it("contains tapering behavior rules", () => {
    const soul = loadSoul();
    expect(soul).toContain("## Tapering behavior");
    expect(soul).toContain("3+ missed");
  });

  it("returns same reference on second call (cached)", () => {
    const first = loadSoul();
    const second = loadSoul();
    // Should be the exact same string reference since it's cached
    expect(first).toBe(second);
  });
});
