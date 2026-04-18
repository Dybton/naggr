/**
 * Entry point for the Naggr bot.
 *
 * Validates the two required environment variables (Telegram token and
 * the single allowed chatId), warms the SOUL.md persona cache, then
 * starts the Telegram bot and the scheduled check-ins. This file is
 * the single source of truth for env-var parsing — `bot.ts` receives
 * the validated chatId as a parameter rather than re-reading the env.
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
// Reject NaN, non-integers, 0 (what `Number(" ")` yields), and unsafe
// integers (Telegram chat IDs fit in 53 bits but `1234567890…` strings
// that overflow would silently round). A zero here would silently deny
// every real chat without a user-visible failure mode.
if (!Number.isSafeInteger(chatId) || chatId === 0) {
  console.error(`JAKOB_CHAT_ID must be a safe nonzero integer, got: ${JSON.stringify(JAKOB_CHAT_ID)}`);
  process.exit(1);
}

/** Boots all services: persona cache, bot, and scheduler. */
const main = async () => {
  loadSoul();
  console.log("[init] SOUL.md loaded");

  const bot = createBot(TELEGRAM_BOT_TOKEN!, chatId);

  startScheduler(bot, chatId);
  console.log("[init] Scheduler started");

  console.log(`[init] Starting Telegram bot (allowed chatId: ${chatId})...`);
  bot.start({
    onStart: () => console.log("[bot] Running"),
  });
};

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
