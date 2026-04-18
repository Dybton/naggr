/**
 * Talks to Claude (the AI) on behalf of the Naggr bot.
 *
 * The design is deliberately stateless: every turn rebuilds the system
 * prompt from disk (SOUL.md persona, protocol.md behavior spec, today's
 * daily log). Claude gets two tools — read_file and write_file — and
 * decides for itself what to ask the user and what to log. No code-side
 * schema, no regex parsing of markdown content.
 *
 * Concurrency: every `callTurn` is serialised per `chatId` via a small
 * promise queue. Without this, a voice message at 08:59:59 and the
 * 09:00 cron tick could both read today's daily file, both call the
 * LLM, and race each other's `write_file` — producing a torn log.
 *
 * Error handling: callers decide what empty / thrown replies mean.
 * - `bot.ts` turns empty into a friendly fallback message.
 * - `scheduler.ts` treats empty (and the `<silent>` sentinel) as
 *   "stay silent on this tick."
 */

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { loadSoul } from "./storage/persona.js";
import { DAILY_DIR, PROTOCOL_PATH } from "./paths.js";
import { parseDailyDate } from "./daily-path.js";

/**
 * Anthropic model alias. If this identifier ever stops resolving, check
 * Anthropic's current model listing — they may require a dated form
 * like `claude-sonnet-4-6-YYYYMMDD`.
 */
const MODEL = "claude-sonnet-4-6";

/** How many tool-call rounds we allow inside a single turn before giving up. */
const MAX_TOOL_ROUNDS = 5;

/** Max output tokens per Anthropic message. */
const MAX_TOKENS = 1024;

/**
 * Per-request Anthropic timeout. The SDK default is 600 seconds, which
 * would pin the event loop for 10 minutes on a single hung response.
 * 60s is generous for a small-prompt chat reply.
 */
const API_TIMEOUT_MS = 60_000;

let client: Anthropic | null = null;

/** Returns the Anthropic client, creating it on first use (after dotenv has loaded). */
const getClient = (): Anthropic => {
  if (!client) client = new Anthropic({ timeout: API_TIMEOUT_MS });
  return client;
};

/** Returns today's date as YYYY-MM-DD in Copenhagen timezone. */
const todayStr = (): string =>
  new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Copenhagen" });

/** Resolves a tool-call `name` to an absolute path, or `null` if the name is not allowed. */
const resolveFile = (name: string): string | null => {
  if (name === "protocol.md") return PROTOCOL_PATH;
  const date = parseDailyDate(name);
  if (date) return join(DAILY_DIR, `${date}.md`);
  return null;
};

/** Returns a blank daily log: just the date header and two newlines. */
const blankDaily = (date: string): string => `# ${date}\n\n`;

/**
 * Makes sure the daily log for the given date exists on disk. Creates
 * `daily/` if it's missing and writes a blank-template file for the
 * date if one doesn't already exist. Returns the absolute path.
 */
const ensureDailyLog = (date: string): string => {
  const p = join(DAILY_DIR, `${date}.md`);
  if (!existsSync(DAILY_DIR)) mkdirSync(DAILY_DIR, { recursive: true });
  if (!existsSync(p)) writeFileSync(p, blankDaily(date), "utf-8");
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
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "File to read, e.g. 'protocol.md' or 'daily/YYYY-MM-DD.md'",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "write_file",
    description: "Overwrite protocol.md or a daily log. A .bak snapshot is saved automatically. Write the COMPLETE file contents — not a diff.",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "File to write, e.g. 'protocol.md' or 'daily/YYYY-MM-DD.md'",
        },
        content: {
          type: "string",
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
 *   - If the last message in `history` is an assistant message and no new
 *     text/image is provided, we also append the stub — Anthropic rejects
 *     a conversation that ends on the assistant role.
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

  const last = msgs[msgs.length - 1];
  if (!last || last.role === "assistant") {
    msgs.push({ role: "user", content: "." });
  }

  return msgs;
};

/**
 * Narrows an untyped tool-call input to a concrete `{name, content?}`
 * shape. The Anthropic SDK types `ToolUseBlock.input` as `unknown` — a
 * blind cast to `Record<string, string>` would silently let a malformed
 * response reach our filesystem code. This guard keeps the cast honest.
 */
const asToolInput = (input: unknown): { name?: string; content?: string } => {
  if (typeof input !== "object" || input === null) return {};
  const rec = input as Record<string, unknown>;
  const out: { name?: string; content?: string } = {};
  if (typeof rec.name === "string") out.name = rec.name;
  if (typeof rec.content === "string") out.content = rec.content;
  return out;
};

/**
 * Routes a tool call to read_file or write_file after validating that
 * the required inputs are actually strings.
 */
const executeTool = (name: string, input: unknown): string => {
  const parsed = asToolInput(input);
  switch (name) {
    case "read_file":
      if (!parsed.name) return JSON.stringify({ error: "read_file requires a string 'name'" });
      return readFile(parsed.name);
    case "write_file":
      if (!parsed.name || parsed.content === undefined) {
        return JSON.stringify({ error: "write_file requires string 'name' and 'content'" });
      }
      return writeFile(parsed.name, parsed.content);
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
};

/**
 * Runs the Anthropic request / tool-call loop for one turn. Extracted
 * from `callTurn` so the mutex wrapper below can stay small.
 */
const runTurn = async (
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
        content: executeTool(block.name, block.input),
      }));

    currentMessages = [
      ...currentMessages,
      { role: "assistant" as const, content: response.content },
      { role: "user" as const, content: toolResults },
    ];
  }

  console.warn(`[llm] tool-call loop exhausted ${MAX_TOOL_ROUNDS} rounds without a final text reply`);
  return {
    reply: "",
    usage: { input: totalInput, output: totalOutput },
  };
};

/**
 * Per-chat serial queue. Each chatId maps to a promise chain — a new
 * `callTurn` waits for the chain to drain before running, then its own
 * work is appended to the chain for the next caller to wait on.
 *
 * Why: user-initiated and scheduled turns both arrive via `callTurn`
 * and both may write today's daily file. Without serialisation, an
 * 08:59:59 voice turn and the 09:00 cron tick could both read a stale
 * file and stomp each other's writes. Serialising per chat makes
 * "only one Claude turn at a time per user" a hard code invariant.
 */
const chatQueues = new Map<number, Promise<unknown>>();

/**
 * Wraps `fn` in the chatId's serial queue. Waits for the previous turn
 * (if any) to finish, runs `fn`, and records its completion promise as
 * the new tail for the next caller to wait on. Prior-turn failures do
 * not poison the chain — later turns still run.
 */
const withChatLock = <T>(chatId: number, fn: () => Promise<T>): Promise<T> => {
  const previous = chatQueues.get(chatId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(fn);
  // Absorb any rejection so a failed turn doesn't surface as an
  // unhandled rejection on the queue tail.
  chatQueues.set(chatId, next.catch(() => undefined));
  return next;
};

/**
 * The single entrypoint for a conversation turn with Claude.
 *
 * Serialises per-chat so turns for the same chatId never run
 * concurrently (see `withChatLock`), then:
 *   1. Builds the system prompt from disk (SOUL + time + protocol + today + rules + optional systemNote).
 *   2. Builds the messages array from history and/or text/image, synthesising a stub user message if needed.
 *   3. Sends to Anthropic. Executes any read_file/write_file tool calls and loops up to `MAX_TOOL_ROUNDS` times.
 *   4. Returns the final text reply (possibly empty) plus input/output token counts.
 *
 * An empty reply means either the LLM returned no text or the tool
 * loop exhausted. Callers decide what to do with it (scheduler treats
 * empty as silent; bot sends a fallback message).
 */
export const callTurn = (
  chatId: number,
  input: TurnInput
): Promise<{ reply: string; usage: { input: number; output: number } }> =>
  withChatLock(chatId, () => runTurn(input));
