/**
 * Telegram bot setup and message routing.
 *
 * Listens for text, voice, and photo messages on Telegram, passes each
 * one through the LLM turn loop, and replies. Two small pieces of
 * bookkeeping live here:
 *
 *   1. An inbound chatId gate: every handler early-returns unless the
 *      incoming message comes from JAKOB_CHAT_ID. Without this gate,
 *      anyone who discovers the bot's handle would get an LLM with
 *      file-write access to Jakob's health data.
 *
 *   2. A tiny in-process message buffer per chat (last few messages),
 *      so mid-conversation references like "actually make it 500" work
 *      even though the LLM is otherwise stateless. The buffer is not
 *      persisted — it's cleared on process restart, and the daily
 *      markdown file is the real source of cross-restart continuity.
 */

import { Bot, type Context } from "grammy";
import { callTurn, type ChatMessage } from "./llm.js";
import { transcribeVoice } from "./voice.js";

/** Total messages kept per chat (user + bot combined). FIFO-trimmed. */
const BUFFER_SIZE = 4;

/** Parsed at module load so the gate runs synchronously on every update. */
const getAllowedChatId = (): number => {
  const raw = process.env.JAKOB_CHAT_ID;
  if (!raw) {
    throw new Error("JAKOB_CHAT_ID must be set in the environment");
  }
  const n = Number(raw);
  if (!Number.isInteger(n)) {
    throw new Error(`JAKOB_CHAT_ID must be an integer, got: ${raw}`);
  }
  return n;
};

const ALLOWED_CHAT_ID = getAllowedChatId();

/** Returns true when the update comes from the one allowed chat. */
const isAllowed = (ctx: Context): boolean => ctx.chat?.id === ALLOWED_CHAT_ID;

// In-memory tiny buffer of recent messages, keyed by chatId.
const chatHistory = new Map<number, ChatMessage[]>();

/** Returns the buffer for a given chat, creating an empty one if needed. */
const getHistory = (chatId: number): ChatMessage[] => {
  if (!chatHistory.has(chatId)) chatHistory.set(chatId, []);
  return chatHistory.get(chatId)!;
};

/** Pushes a message into the buffer and trims back down to BUFFER_SIZE. */
const pushHistory = (chatId: number, msg: ChatMessage): void => {
  const h = getHistory(chatId);
  h.push(msg);
  if (h.length > BUFFER_SIZE) {
    h.splice(0, h.length - BUFFER_SIZE);
  }
};

/** Runs a text-input turn through callTurn and sends the reply on Telegram. */
const handleText = async (ctx: Context, text: string): Promise<void> => {
  const chatId = ctx.chat!.id;
  const userMsg: ChatMessage = { role: "user", content: text };
  pushHistory(chatId, userMsg);

  const { reply, usage } = await callTurn({
    text,
    history: getHistory(chatId).slice(0, -1), // history excludes the message we just pushed
  });
  console.log(
    `[turn] "${text.slice(0, 40)}" | tokens: ${usage.input}in/${usage.output}out`
  );

  if (reply) {
    pushHistory(chatId, { role: "assistant", content: reply });
    await ctx.reply(reply);
  }
};

/** Creates and configures the Grammy bot with handlers for text, voice, and photo messages. */
export const createBot = (token: string): Bot => {
  const bot = new Bot(token);

  bot.catch((err) => {
    console.error("[bot] Error handling update:", err.message);
  });

  bot.on("message:text", async (ctx) => {
    if (!isAllowed(ctx)) return;
    await handleText(ctx, ctx.message.text);
  });

  bot.on("message:voice", async (ctx) => {
    if (!isAllowed(ctx)) return;
    try {
      const file = await ctx.getFile();
      const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
      const text = await transcribeVoice(fileUrl);
      console.log(`[voice] Transcribed: "${text}"`);
      await handleText(ctx, text);
    } catch (err) {
      console.error("[voice] Transcription failed:", err);
      await ctx.reply(
        "Kunne ikke forstå beskeden. Prøv at sende tekst i stedet."
      );
    }
  });

  bot.on("message:photo", async (ctx) => {
    if (!isAllowed(ctx)) return;

    const file = await ctx.getFile();
    const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
    const response = await fetch(fileUrl);
    const buffer = Buffer.from(await response.arrayBuffer());
    const base64 = buffer.toString("base64");

    const caption = ctx.message.caption || "Food photo";
    const chatId = ctx.chat.id;

    // Preserve the photo+caption as a structured user message in the
    // buffer so a later turn can still refer to it ("make it 500").
    const userContent: ChatMessage = {
      role: "user",
      content: [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/jpeg",
            data: base64,
          },
        },
        { type: "text", text: caption },
      ],
    };
    pushHistory(chatId, userContent);

    const { reply, usage } = await callTurn({
      image: { base64, mediaType: "image/jpeg", caption },
      history: getHistory(chatId).slice(0, -1),
    });
    console.log(
      `[turn] photo | tokens: ${usage.input}in/${usage.output}out`
    );

    if (reply) {
      pushHistory(chatId, { role: "assistant", content: reply });
      await ctx.reply(reply);
    }
  });

  return bot;
};
