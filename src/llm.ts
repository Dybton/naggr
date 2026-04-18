/**
 * Talks to Claude (the AI) on behalf of the Naggr bot.
 *
 * The design is deliberately stateless: every turn rebuilds the system
 * prompt from disk (SOUL.md persona, protocol.md behavior spec, today's
 * daily log). Claude gets two tools — read_file and write_file — and
 * decides for itself what to ask the user and what to log. No code-side
 * schema, no regex parsing of markdown content.
 *
 * Both user-initiated turns (from bot.ts) and scheduled turns (from
 * scheduler.ts) go through `callTurn`. Scheduled turns pass a
 * `systemNote` and no user text; user-initiated turns pass `text` or
 * `image` plus an optional short history buffer.
 *
 * Before every write, we snapshot the target file to `<name>.bak` so a
 * bad edit can be rolled back manually.
 */

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { loadSoul } from "./storage/persona.js";

const DATA_DIR = join(__dirname, "..");
const DAILY_DIR = join(DATA_DIR, "daily");
const PROTOCOL_PATH = join(DATA_DIR, "protocol.md");

/**
 * Anthropic model alias. If this identifier ever stops resolving, check
 * Anthropic's current model listing — they may require a dated form like
 * `claude-sonnet-4-6-YYYYMMDD`.
 */
const MODEL = "claude-sonnet-4-6";

/** How many tool-call rounds we allow inside a single turn before giving up. */
const MAX_TOOL_ROUNDS = 5;

/** Max output tokens per Anthropic message. */
const MAX_TOKENS = 1024;

let client: Anthropic | null = null;

/** Returns the Anthropic client, creating it on first use (after dotenv has loaded). */
const getClient = (): Anthropic => {
  if (!client) client = new Anthropic();
  return client;
};

/** Returns today's date as YYYY-MM-DD in Copenhagen timezone. */
const todayStr = (): string =>
  new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Copenhagen" });

/**
 * Checks whether a tool-call `name` is a valid `daily/YYYY-MM-DD.md` path,
 * without using a regex. The steps are:
 *   1. Must start with `daily/` and end with `.md`.
 *   2. The middle segment is split on `-` into exactly 3 parts with
 *      lengths 4/2/2.
 *   3. Each part must be all digits.
 *   4. The date must round-trip through Date: parsing and re-serialising
 *      it to ISO `YYYY-MM-DD` must yield the same string (rejects things
 *      like `2026-02-30` that the constructor silently normalises).
 *
 * Returns the `YYYY-MM-DD` stem on success, `null` otherwise.
 */
const parseDailyDate = (name: string): string | null => {
  const prefix = "daily/";
  const suffix = ".md";
  if (!name.startsWith(prefix) || !name.endsWith(suffix)) return null;

  const stem = name.slice(prefix.length, name.length - suffix.length);
  const parts = stem.split("-");
  if (parts.length !== 3) return null;

  const [y, m, d] = parts;
  if (y.length !== 4 || m.length !== 2 || d.length !== 2) return null;

  const isDigits = (s: string): boolean => {
    for (const ch of s) {
      if (ch < "0" || ch > "9") return false;
    }
    return true;
  };
  if (!isDigits(y) || !isDigits(m) || !isDigits(d)) return null;

  const asDate = new Date(`${stem}T00:00:00Z`);
  if (isNaN(asDate.getTime())) return null;
  if (asDate.toISOString().slice(0, 10) !== stem) return null;

  return stem;
};

/** Resolves a tool-call `name` to an absolute path, or `null` if the name is not allowed. */
const resolveFile = (name: string): string | null => {
  if (name === "protocol.md") return PROTOCOL_PATH;
  const date = parseDailyDate(name);
  if (date) return join(DAILY_DIR, `${date}.md`);
  return null;
};

/** Returns a blank daily log: just the date header and two newlines. */
const blankDaily = (date: string): string => `# ${date}\n\n`;

/** Makes sure today's daily log file exists. Creates it from the minimal template if missing. */
const ensureDailyLog = (date?: string): string => {
  const d = date ?? todayStr();
  const p = join(DAILY_DIR, `${d}.md`);
  if (!existsSync(DAILY_DIR)) mkdirSync(DAILY_DIR, { recursive: true });
  if (!existsSync(p)) writeFileSync(p, blankDaily(d), "utf-8");
  return p;
};

/** Reads a file — the tool implementation Claude calls. Returns the file contents or a JSON error. */
const readFile = (name: string): string => {
  const path = resolveFile(name);
  if (!path) return JSON.stringify({ error: `Unknown file: ${name}. Allowed: protocol.md, daily/YYYY-MM-DD.md` });
  if (!existsSync(path)) return JSON.stringify({ error: `File not found: ${name}` });
  return readFileSync(path, "utf-8");
};

/** Writes a file — the tool implementation Claude calls. Saves a .bak snapshot first. */
const writeFile = (name: string, content: string): string => {
  const path = resolveFile(name);
  if (!path) return JSON.stringify({ error: `Unknown file: ${name}. Allowed: protocol.md, daily/YYYY-MM-DD.md` });

  if (existsSync(path)) {
    copyFileSync(path, path + ".bak");
  }

  writeFileSync(path, content, "utf-8");
  return JSON.stringify({ success: true, file: name });
};

const tools: Anthropic.Messages.Tool[] = [
  {
    name: "read_file",
    description: "Read protocol.md or a daily log at daily/YYYY-MM-DD.md",
    input_schema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string" as const,
          description: "File to read, e.g. 'protocol.md' or 'daily/2026-04-18.md'",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "write_file",
    description: "Overwrite protocol.md or a daily log. A .bak snapshot is saved automatically. Write the COMPLETE file contents — not a diff.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string" as const,
          description: "File to write, e.g. 'protocol.md' or 'daily/2026-04-18.md'",
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
 * Reads protocol.md from disk, or returns a short fallback string if the file is
 * missing. Prevents fresh-host deploy loops where the whole bot crashes because
 * protocol.md isn't yet on the server.
 */
const readProtocol = (): string => {
  if (!existsSync(PROTOCOL_PATH)) {
    return "Protocol file not found. Ask the user what their daily protocol should be, then write it to protocol.md.";
  }
  return readFileSync(PROTOCOL_PATH, "utf-8");
};

/**
 * Builds the system prompt on every turn by stitching together:
 *   - SOUL.md (the persona, cached in memory after first read)
 *   - The current time in Europe/Copenhagen
 *   - protocol.md (with a graceful fallback if missing)
 *   - Today's daily log (created blank if missing)
 *   - A minimal rules block
 *   - An optional one-turn systemNote (used by scheduled check-ins)
 */
const buildSystemPrompt = (systemNote?: string): string => {
  const soul = loadSoul();
  const today = todayStr();
  ensureDailyLog(today);

  const protocol = readProtocol();
  const dailyLog = readFileSync(join(DAILY_DIR, `${today}.md`), "utf-8");

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

---
RULES:
- Reply in 1-3 sentences. This is texting.
- Platform: Telegram. No markdown tables. Use **bold** for emphasis.
- When the user logs a meal, supplement, sleep, or a daily summary, append it to today's daily file via write_file, using the shape defined in protocol.md.
- Estimate meal macros yourself based on typical Danish portions.
- You already have today's log and protocol in context. Only call read_file if you need a different day's log (rare) or need to re-read after a write.
- When using write_file, always write the COMPLETE file contents — not a partial update.`;

  if (systemNote) {
    system += `\n\n${systemNote}`;
  }

  return system;
};

export interface ChatMessage {
  role: "user" | "assistant";
  content: string | Anthropic.Messages.ContentBlockParam[];
}

export interface TurnInput {
  /** User text message. */
  text?: string;
  /** User image with an optional caption. */
  image?: { base64: string; mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; caption?: string };
  /** One-turn systemNote appended to the system prompt. Used by scheduled ticks. */
  systemNote?: string;
  /** Tiny buffer of recent messages (from bot.ts). Omitted on scheduled ticks. */
  history?: ChatMessage[];
}

/**
 * Turns a `TurnInput` into the `messages` array the Anthropic API needs.
 *
 * Rules:
 *   - If `history` is provided, it's used as-is.
 *   - If the caller provides `text` or `image`, that becomes a final user
 *     message appended after any history.
 *   - If neither history, text, nor image is given (a pure-systemNote
 *     scheduled call), we synthesize a stub user message (`"."`) — the
 *     Anthropic API requires at least one user message, and the real
 *     prompt-shaping happens inside the system prompt's systemNote.
 */
const buildMessages = (input: TurnInput): Anthropic.Messages.MessageParam[] => {
  const msgs: Anthropic.Messages.MessageParam[] = (input.history ?? []).map(
    (m) => ({ role: m.role, content: m.content })
  );

  if (input.image) {
    msgs.push({
      role: "user",
      content: [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: input.image.mediaType,
            data: input.image.base64,
          },
        },
        { type: "text", text: input.image.caption ?? "" },
      ],
    });
  } else if (input.text !== undefined) {
    msgs.push({ role: "user", content: input.text });
  }

  if (msgs.length === 0) {
    msgs.push({ role: "user", content: "." });
  }

  return msgs;
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

/**
 * The single entrypoint for a conversation turn with Claude.
 *
 * Steps:
 *   1. Build the system prompt from disk (SOUL + time + protocol + today + rules + optional systemNote).
 *   2. Build the messages array from history and/or text/image, synthesising a stub user message if the caller has none.
 *   3. Send to Anthropic. If Claude calls read_file or write_file, execute them and loop up to MAX_TOOL_ROUNDS times.
 *   4. Return the final text reply (possibly empty) plus input/output token counts.
 *
 * Callers decide what an empty reply means — bot.ts sends it unchanged,
 * scheduler.ts treats it (and the literal `<silent>` sentinel) as
 * "don't message the user."
 */
export const callTurn = async (
  input: TurnInput
): Promise<{ reply: string; usage: { input: number; output: number } }> => {
  const system = buildSystemPrompt(input.systemNote);
  let currentMessages = buildMessages(input);

  let totalInput = 0;
  let totalOutput = 0;

  for (let i = 0; i < MAX_TOOL_ROUNDS; i++) {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
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
      const reply = textBlocks.map((b) => b.text).join("");
      return { reply, usage: { input: totalInput, output: totalOutput } };
    }

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
  }

  return {
    reply: "",
    usage: { input: totalInput, output: totalOutput },
  };
};
