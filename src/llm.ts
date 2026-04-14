/**
 * Talks to Claude (the AI) on behalf of the Naggr bot.
 *
 * Instead of complex structured tools, we give Claude two simple tools:
 *   - read_file: read any of the known markdown files
 *   - write_file: overwrite any of the known markdown files (with a backup)
 *
 * Claude already understands the markdown format, so it can directly edit
 * daily logs, mark supplements, update protocol, etc. This avoids all the
 * schema mismatch bugs we had with structured tools.
 *
 * Before every write, we snapshot the file so a bad edit can be rolled back.
 */

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { loadSoul } from "./storage/persona.js";

const DATA_DIR = join(__dirname, "..");
const DAILY_DIR = join(DATA_DIR, "daily");

/** The only files the LLM is allowed to read and write. */
const ALLOWED_FILES: Record<string, string> = {
  "protocol.md": join(DATA_DIR, "protocol.md"),
  "AGENTS.md": join(DATA_DIR, "AGENTS.md"),
  "users.md": join(DATA_DIR, "users.md"),
};

let client: Anthropic | null = null;

/** Returns the Anthropic client, creating it on first use (after dotenv has loaded). */
const getClient = (): Anthropic => {
  if (!client) client = new Anthropic();
  return client;
};

/** Resolves a filename to an absolute path. Supports "daily/YYYY-MM-DD.md" and the fixed files. */
const resolveFile = (name: string): string | null => {
  if (ALLOWED_FILES[name]) return ALLOWED_FILES[name];

  const dailyMatch = name.match(/^daily\/(\d{4}-\d{2}-\d{2})\.md$/);
  if (dailyMatch) return join(DAILY_DIR, `${dailyMatch[1]}.md`);

  return null;
};

/** Returns today's date as YYYY-MM-DD in Copenhagen timezone. */
const todayStr = (): string =>
  new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Copenhagen" });

/** Creates a blank daily log for the given date. */
const blankDaily = (date: string): string => `# ${date}

## Meals

## Supplements
- [ ] Omega-3 (with breakfast shake)
- [ ] Vitamin D3 5000 IU x3 (with breakfast)
- [ ] Magnesium glycinate (morning)
- [ ] Zinc (morning)
- [ ] Chemo + magnesium (21:00)
- [ ] Melatonin (before bed)

## Sleep
(not logged)

## Exercise
(none logged)

## Running Totals
- Calories: ~0 / 3500 kcal
- Protein: ~0 / 180g
- Carbs: ~0g
- Fat: ~0g

## Notes
`;

/** Makes sure today's daily log file exists. Creates it from template if missing. */
const ensureDailyLog = (date?: string): string => {
  const d = date ?? todayStr();
  const p = join(DAILY_DIR, `${d}.md`);
  if (!existsSync(DAILY_DIR)) mkdirSync(DAILY_DIR, { recursive: true });
  if (!existsSync(p)) writeFileSync(p, blankDaily(d), "utf-8");
  return p;
};

/** Reads a file — the tool implementation Claude calls. Returns the file contents or an error. */
const readFile = (name: string): string => {
  const path = resolveFile(name);
  if (!path) return JSON.stringify({ error: `Unknown file: ${name}. Allowed: protocol.md, AGENTS.md, users.md, daily/YYYY-MM-DD.md` });
  if (!existsSync(path)) return JSON.stringify({ error: `File not found: ${name}` });
  return readFileSync(path, "utf-8");
};

/** Writes a file — the tool implementation Claude calls. Saves a .bak snapshot first. */
const writeFile = (name: string, content: string): string => {
  const path = resolveFile(name);
  if (!path) return JSON.stringify({ error: `Unknown file: ${name}. Allowed: protocol.md, AGENTS.md, users.md, daily/YYYY-MM-DD.md` });

  // Snapshot before overwriting
  if (existsSync(path)) {
    copyFileSync(path, path + ".bak");
  }

  writeFileSync(path, content, "utf-8");
  return JSON.stringify({ success: true, file: name });
};

const tools: Anthropic.Messages.Tool[] = [
  {
    name: "read_file",
    description: "Read one of the markdown files: protocol.md, AGENTS.md, users.md, or daily/YYYY-MM-DD.md",
    input_schema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string" as const,
          description: "File to read, e.g. 'protocol.md' or 'daily/2026-04-14.md'",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "write_file",
    description: "Overwrite one of the markdown files. A backup is saved automatically. Write the COMPLETE file contents — not a diff or partial update.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string" as const,
          description: "File to write, e.g. 'protocol.md' or 'daily/2026-04-14.md'",
        },
        content: {
          type: "string" as const,
          description: "The full new contents of the file",
        },
      },
      required: ["name", "content"],
    },
  },
];

/**
 * Builds the system prompt by loading SOUL.md (cached), protocol.md (raw),
 * today's daily log (raw), and AGENTS.md (raw). Includes the current time
 * and rules for how to behave. Optionally appends an extra note for
 * scheduled reminders.
 */
const buildSystemPrompt = (extraNote?: string): string => {
  const soul = loadSoul();
  const today = todayStr();
  ensureDailyLog(today);

  const protocol = readFileSync(join(DATA_DIR, "protocol.md"), "utf-8");
  const dailyLog = readFileSync(join(DAILY_DIR, `${today}.md`), "utf-8");
  const agents = readFileSync(join(DATA_DIR, "AGENTS.md"), "utf-8");

  const now = new Date().toLocaleString("da-DK", {
    timeZone: "Europe/Copenhagen",
  });

  let system = `${soul}

---
CURRENT TIME: ${now}
TODAY'S FILE: daily/${today}.md

PROTOCOL (protocol.md):
${protocol}

TODAY'S LOG (daily/${today}.md):
${dailyLog}

AGENT STATE (AGENTS.md):
${agents}

---
RULES:
- Reply in 1-3 sentences. This is texting.
- Platform: Telegram. No markdown tables. Use **bold** for emphasis.
- When logging food, estimate macros yourself based on typical Danish portions. Update the Running Totals section to match.
- When the user says "done" or similar after a supplement reminder, mark the relevant supplements as [x] with the current time.
- Use write_file to save any changes. Always write the COMPLETE file — not a partial update.
- Be honest about numbers. Don't exaggerate streaks or progress. 1 day is not a "solid streak".
- You already have today's log and protocol in context. Only use read_file if you need a different day's log or need to re-read after a write.`;

  if (extraNote) {
    system += `\n\n${extraNote}`;
  }

  return system;
};

export interface ChatMessage {
  role: "user" | "assistant";
  content: string | Anthropic.Messages.ContentBlockParam[];
}

/**
 * The main entry point for a conversation turn with Claude.
 *
 * Takes message history and an optional system note, then:
 *  1. Builds the system prompt with all current file contents.
 *  2. Sends to Claude's API.
 *  3. If Claude calls read_file or write_file, executes them and feeds
 *     results back so Claude can continue.
 *  4. Repeats up to 5 rounds.
 *  5. Returns the final text reply and token usage.
 */
export const callTurn = async (
  messages: ChatMessage[],
  extraSystemNote?: string
): Promise<{ reply: string; usage: { input: number; output: number } }> => {
  const system = buildSystemPrompt(extraSystemNote);

  let currentMessages: Anthropic.Messages.MessageParam[] = messages.map(
    (m) => ({
      role: m.role,
      content: m.content,
    })
  );

  let totalInput = 0;
  let totalOutput = 0;

  for (let i = 0; i < 5; i++) {
    const response = await getClient().messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system,
      messages: currentMessages,
      tools,
    });

    totalInput += response.usage.input_tokens;
    totalOutput += response.usage.output_tokens;

    const textBlocks = response.content.filter(
      (b): b is Anthropic.Messages.TextBlock => b.type === "text"
    );
    const toolBlocks = response.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use"
    );

    if (toolBlocks.length === 0 || response.stop_reason === "end_turn") {
      const reply = textBlocks.map((b) => b.text).join("") || "";
      if (reply) {
        return { reply, usage: { input: totalInput, output: totalOutput } };
      }
    }

    if (toolBlocks.length > 0) {
      const toolResults: Anthropic.Messages.ToolResultBlockParam[] =
        toolBlocks.map((block) => ({
          type: "tool_result" as const,
          tool_use_id: block.id,
          content: executeTool(block.name, block.input as Record<string, string>),
        }));

      currentMessages = [
        ...currentMessages,
        { role: "assistant" as const, content: response.content },
        { role: "user" as const, content: toolResults },
      ];

      if (response.stop_reason === "end_turn" && textBlocks.length > 0) {
        return {
          reply: textBlocks.map((b) => b.text).join(""),
          usage: { input: totalInput, output: totalOutput },
        };
      }
    }
  }

  return {
    reply: "I got a bit tangled up. Could you say that again?",
    usage: { input: totalInput, output: totalOutput },
  };
};

/** Routes a tool call to read_file or write_file. */
const executeTool = (name: string, input: Record<string, string>): string => {
  switch (name) {
    case "read_file":
      return readFile(input.name);
    case "write_file":
      return writeFile(input.name, input.content);
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
};
