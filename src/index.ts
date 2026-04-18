/**
 * Entry point for the Naggr bot.
 * Loads environment variables, warms the SOUL.md cache,
 * then starts the Telegram bot and the scheduled check-ins.
 */

import { config } from "dotenv";
config({ override: true });
import { createBot } from "./bot.js";
import { startScheduler } from "./scheduler.js";
import { loadSoul } from "./storage/persona.js";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const JAKOB_CHAT_ID = process.env.JAKOB_CHAT_ID;

if (!TELEGRAM_BOT_TOKEN) {
  console.error("Missing TELEGRAM_BOT_TOKEN in .env");
  process.exit(1);
}
if (!JAKOB_CHAT_ID) {
  console.error("Missing JAKOB_CHAT_ID in .env");
  process.exit(1);
}

const chatId = Number(JAKOB_CHAT_ID);
if (!Number.isInteger(chatId)) {
  console.error(`JAKOB_CHAT_ID must be an integer, got: ${JAKOB_CHAT_ID}`);
  process.exit(1);
}

/** Boots all services: persona cache, bot, and scheduler. */
const main = async () => {
  loadSoul();
  console.log("[init] SOUL.md loaded");

  const bot = createBot(TELEGRAM_BOT_TOKEN!);

  startScheduler(bot, chatId);
  console.log("[init] Scheduler started");

  console.log("[init] Starting Telegram bot...");
  bot.start({
    onStart: () => console.log("[bot] Running"),
  });
};

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
