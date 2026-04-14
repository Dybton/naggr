/**
 * Telegram bot setup and message routing.
 * Listens for text, voice, and photo messages on Telegram,
 * then passes them through the LLM turn loop and replies.
 */

import { Bot, type Context } from "grammy";
import { callTurn, type ChatMessage } from "./llm.js";
import { transcribeVoice } from "./voice.js";

// In-memory ring buffer of recent messages per chat, keyed by chatId
const chatHistory = new Map<number, ChatMessage[]>();
const MAX_HISTORY = 10;

/** Returns the chat history array for a given chat, creating one if it doesn't exist. */
const getHistory = (chatId: number): ChatMessage[] => {
  if (!chatHistory.has(chatId)) chatHistory.set(chatId, []);
  return chatHistory.get(chatId)!;
};

/** Adds a message to the chat history ring buffer, trimming old entries to keep the last MAX_HISTORY pairs. */
const pushHistory = (chatId: number, msg: ChatMessage): void => {
  const history = getHistory(chatId);
  history.push(msg);
  if (history.length > MAX_HISTORY * 2) {
    history.splice(0, history.length - MAX_HISTORY * 2);
  }
};

/** Takes a text message, sends it through the LLM, and replies on Telegram. */
const handleMessage = async (ctx: Context, text: string): Promise<void> => {
  const chatId = ctx.chat!.id;

  pushHistory(chatId, { role: "user", content: text });

  const { reply, usage } = await callTurn(getHistory(chatId));
  console.log(
    `[turn] "${text.slice(0, 40)}" | tokens: ${usage.input}in/${usage.output}out`
  );

  pushHistory(chatId, { role: "assistant", content: reply });
  await ctx.reply(reply);
};

/** Creates and configures the Grammy bot with handlers for text, voice, and photo messages. */
export const createBot = (token: string): Bot => {
  const bot = new Bot(token);

  // Catch errors so the bot doesn't crash on a single bad message
  bot.catch((err) => {
    console.error("[bot] Error handling update:", err.message);
  });

  // Handle text messages
  bot.on("message:text", async (ctx) => {
    await handleMessage(ctx, ctx.message.text);
  });

  // Handle voice messages — downloads the audio, transcribes via Whisper, then treats it as text
  bot.on("message:voice", async (ctx) => {
    try {
      const file = await ctx.getFile();
      const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
      const text = await transcribeVoice(fileUrl);
      console.log(`[voice] Transcribed: "${text}"`);
      await handleMessage(ctx, text);
    } catch (err) {
      console.error("[voice] Transcription failed:", err);
      await ctx.reply(
        "Kunne ikke forstå beskeden. Prøv at sende tekst i stedet."
      );
    }
  });

  // Handle photos — downloads the image, base64-encodes it, and sends it to the LLM with the caption
  bot.on("message:photo", async (ctx) => {
    const file = await ctx.getFile();
    const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

    const response = await fetch(fileUrl);
    const buffer = Buffer.from(await response.arrayBuffer());
    const base64 = buffer.toString("base64");

    const caption = ctx.message.caption || "Food photo";
    const chatId = ctx.chat.id;

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

    const { reply, usage } = await callTurn(getHistory(chatId));
    console.log(
      `[turn] photo | tokens: ${usage.input}in/${usage.output}out`
    );

    pushHistory(chatId, { role: "assistant", content: reply });
    await ctx.reply(reply);
  });

  return bot;
};

/** Sends a message to a specific chat. Used by the scheduler to push reminders. */
export const sendMessage = (bot: Bot, chatId: number, text: string) =>
  bot.api.sendMessage(chatId, text);
