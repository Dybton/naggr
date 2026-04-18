/**
 * Telegram bot setup and message routing.
 *
 * Listens for text, voice, and photo messages on Telegram, passes each
 * one through the LLM turn loop, and replies. Two small pieces of
 * bookkeeping live here:
 *
 *   1. An inbound chatId gate: every handler early-returns unless the
 *      incoming message comes from the single allowed chatId the caller
 *      passed to `createBot`. Without this gate, anyone who discovers
 *      the bot's handle would get an LLM with file-write access to
 *      Jakob's health data.
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

/** Fallback text sent when callTurn returns an empty reply on a user turn. */
const EMPTY_REPLY_FALLBACK = "Hmm, I got tangled up. Could you say that again?";

/** Fallback text sent when the photo handler catches an unexpected error. */
const PHOTO_ERROR_FALLBACK = "Sorry — something broke handling that photo. Try sending it as text?";

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

/**
 * Creates and configures the Grammy bot.
 *
 * Takes the bot token and the one allowed chatId as arguments — both
 * validated by `index.ts` before we get here. Every handler checks
 * incoming `ctx.chat?.id` against the allowed value and silently
 * returns on mismatch. Handlers also:
 *   - Keep a tiny per-chat message buffer so mid-conversation
 *     references still work ("make it 500", "that one").
 *   - Always push a user+assistant pair per turn. If the LLM returns
 *     an empty reply, we push a short fallback so the buffer never
 *     ends on a lone user message (the Anthropic API would reject the
 *     next turn built from such a buffer).
 */
export const createBot = (token: string, allowedChatId: number): Bot => {
  const bot = new Bot(token);

  /** True when the incoming update is from the one allowed chatId. */
  const isAllowed = (ctx: Context): boolean => ctx.chat?.id === allowedChatId;

  /**
   * Runs one text-input turn:
   *   1. Push the user message into the per-chat buffer.
   *   2. Call the LLM with the buffer (minus the just-pushed message,
   *      because callTurn re-appends it via the `text` input).
   *   3. If the reply is empty (rare: tool-loop exhaustion), substitute
   *      a friendly fallback so the user isn't left hanging AND the
   *      buffer stays well-formed.
   *   4. Push the (possibly-fallback) reply into the buffer.
   *   5. Send it to Telegram.
   *
   * Wrapping the whole body in try/catch means a thrown callTurn (API
   * outage, missing SOUL.md, etc.) tells the user what happened
   * instead of silently dying inside grammy's error sink.
   */
  const handleText = async (ctx: Context, text: string): Promise<void> => {
    const chatId = ctx.chat!.id;
    pushHistory(chatId, { role: "user", content: text });

    try {
      const { reply, usage } = await callTurn(chatId, {
        text,
        history: getHistory(chatId).slice(0, -1),
      });
      console.log(
        `[turn] "${text.slice(0, 40)}" | tokens: ${usage.input}in/${usage.output}out`
      );

      const finalReply = reply || EMPTY_REPLY_FALLBACK;
      pushHistory(chatId, { role: "assistant", content: finalReply });
      await ctx.reply(finalReply);
    } catch (err) {
      console.error("[bot] text handler failed:", err);
      await ctx.reply(EMPTY_REPLY_FALLBACK);
    }
  };

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

    const chatId = ctx.chat.id;

    try {
      const file = await ctx.getFile();
      const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
      const response = await fetch(fileUrl);
      const buffer = Buffer.from(await response.arrayBuffer());
      const base64 = buffer.toString("base64");
      const caption = ctx.message.caption || "Food photo";

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

      const { reply, usage } = await callTurn(chatId, {
        image: { base64, mediaType: "image/jpeg", caption },
        history: getHistory(chatId).slice(0, -1),
      });
      console.log(
        `[turn] photo | tokens: ${usage.input}in/${usage.output}out`
      );

      const finalReply = reply || EMPTY_REPLY_FALLBACK;
      pushHistory(chatId, { role: "assistant", content: finalReply });
      await ctx.reply(finalReply);
    } catch (err) {
      console.error("[bot] photo handler failed:", err);
      await ctx.reply(PHOTO_ERROR_FALLBACK);
    }
  });

  return bot;
};
