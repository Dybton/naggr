import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { backupFile, writeFixture, readFixture } from "./helpers.js";
import { loadSoul } from "../src/storage/persona.js";
import { readDaily, ensureDaily } from "../src/storage/daily.js";
import { readAgents, condensedAgents } from "../src/storage/agents.js";
import { logFood } from "../src/tools/logFood.js";
import { logSupplement } from "../src/tools/logSupplement.js";
import { readStatus } from "../src/tools/readStatus.js";
import { updateProtocol } from "../src/tools/updateProtocol.js";
import { updateAgents } from "../src/tools/updateAgents.js";
import { logFoodSchema } from "../src/tools/logFood.js";
import { logSupplementSchema } from "../src/tools/logSupplement.js";
import { readStatusSchema } from "../src/tools/readStatus.js";
import { updateProtocolSchema } from "../src/tools/updateProtocol.js";
import { updateAgentsSchema } from "../src/tools/updateAgents.js";

// Mock Anthropic SDK to avoid needing API key for condensedProtocol
vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: vi.fn() };
  },
}));

describe("LLM integration", () => {
  describe("context size", () => {
    let restoreAgents: () => void;

    beforeEach(() => {
      restoreAgents = backupFile("AGENTS.md");
      writeFixture("AGENTS.md", readFixture("agents.md"));
    });

    afterEach(() => {
      restoreAgents();
    });

    it("system prompt components are under 3k tokens (~12k chars)", () => {
      ensureDaily();
      const soul = loadSoul();
      const daily = readDaily();
      const agents = condensedAgents(readAgents());

      // Build a representative system prompt without the protocol LLM call
      const systemPrompt = `${soul}\n\n---\nCURRENT STATE:\n\nProtocol:\nDiet: 3500 kcal, 180g protein\nSupplements: (6 items)\nBedtime: 22:00\n\nToday:\nMeals: ${daily.meals.length}\nTotals: ${daily.totals.kcal}/3500 kcal\nSupplements: ${daily.supplements.filter((s) => s.done).length}/${daily.supplements.length}\n\nAgent state:\n${agents}`;

      // ~4 chars per token, 3k tokens = 12k chars
      expect(systemPrompt.length).toBeLessThan(12000);
      expect(systemPrompt.length).toBeGreaterThan(500);
    });
  });

  describe("tool dispatch", () => {
    it("all 5 tool functions are callable", () => {
      expect(typeof logFood).toBe("function");
      expect(typeof logSupplement).toBe("function");
      expect(typeof readStatus).toBe("function");
      expect(typeof updateProtocol).toBe("function");
      expect(typeof updateAgents).toBe("function");
    });

    it("readStatus returns parseable JSON", () => {
      ensureDaily();
      const result = readStatus();
      expect(() => JSON.parse(result)).not.toThrow();
    });
  });

  describe("chat history ring buffer", () => {
    it("maintains max 4 pairs (8 entries)", () => {
      const MAX_HISTORY = 4;
      const history: Array<{ role: string; content: string }> = [];

      function push(msg: { role: string; content: string }) {
        history.push(msg);
        if (history.length > MAX_HISTORY * 2) {
          history.splice(0, history.length - MAX_HISTORY * 2);
        }
      }

      for (let i = 0; i < 6; i++) {
        push({ role: "user", content: `msg ${i}` });
        push({ role: "assistant", content: `reply ${i}` });
      }

      expect(history).toHaveLength(8);
      expect(history[0].content).toBe("msg 2");
      expect(history[7].content).toBe("reply 5");
    });

    it("5th message pushes out the 1st pair", () => {
      const MAX_HISTORY = 4;
      const history: Array<{ role: string; content: string }> = [];

      function push(msg: { role: string; content: string }) {
        history.push(msg);
        if (history.length > MAX_HISTORY * 2) {
          history.splice(0, history.length - MAX_HISTORY * 2);
        }
      }

      for (let i = 0; i < 4; i++) {
        push({ role: "user", content: `msg ${i}` });
        push({ role: "assistant", content: `reply ${i}` });
      }
      expect(history).toHaveLength(8);
      expect(history[0].content).toBe("msg 0");

      push({ role: "user", content: "msg 4" });
      push({ role: "assistant", content: "reply 4" });

      expect(history).toHaveLength(8);
      expect(history[0].content).toBe("msg 1");
      expect(history[1].content).toBe("reply 1");
    });
  });

  describe("tool schemas", () => {
    it("all tool schemas have required name, description, input_schema", () => {
      const schemas = [
        logFoodSchema,
        logSupplementSchema,
        readStatusSchema,
        updateProtocolSchema,
        updateAgentsSchema,
      ];

      for (const schema of schemas) {
        expect(schema).toHaveProperty("name");
        expect(schema).toHaveProperty("description");
        expect(schema).toHaveProperty("input_schema");
        expect(schema.input_schema).toHaveProperty("type", "object");
        expect(typeof schema.name).toBe("string");
        expect(typeof schema.description).toBe("string");
      }
    });

    it("tool names match expected values", () => {
      expect(logFoodSchema.name).toBe("log_food");
      expect(logSupplementSchema.name).toBe("log_supplement");
      expect(readStatusSchema.name).toBe("read_status");
      expect(updateProtocolSchema.name).toBe("update_protocol");
      expect(updateAgentsSchema.name).toBe("update_agents");
    });
  });
});
