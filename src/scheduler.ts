/**
 * Cron-based check-in scheduler.
 *
 * Runs four fixed jobs per day (morning, lunch, dinner, evening) in
 * Europe/Copenhagen time. Each job does exactly one thing: hand the LLM
 * a short `systemNote` describing this check-in, then send whatever
 * reply the LLM produces to Telegram.
 *
 * The LLM decides what's missing by reading today's daily log and the
 * protocol (both already in the system prompt). If everything is
 * already logged, it returns the literal string `<silent>` and we send
 * no Telegram message at all.
 *
 * On transient Claude API failures (5xx or network), each scheduled
 * tick retries exactly once after a 60-second delay before giving up.
 * This is distinct from "retry nagging the user," which spec1 prohibits.
 */

import cron from "node-cron";
import type { Bot } from "grammy";
import { callTurn } from "./llm.js";

/** Timezone for all cron schedules. */
const TZ = "Europe/Copenhagen";

/** Sentinel the LLM is instructed to return when nothing needs to be asked. */
const SILENT = "<silent>";

/** Delay before retrying once on a transient API failure. */
const RETRY_DELAY_MS = 60_000;

/** Shape of one scheduled check-in. */
interface CheckIn {
  readonly cronExpr: string;
  readonly label: string;
  readonly systemNote: string;
}

const CHECK_INS: readonly CheckIn[] = [
  {
    cronExpr: "0 9 * * *",
    label: "MORNING",
    systemNote:
      "This is the 09:00 MORNING CHECK-IN. The protocol and today's log are in the system prompt above. Ask about whatever is still missing from: sleep, morning supplements, breakfast. Ask in one concise Telegram message. " +
      `If all three are already logged for today, reply with exactly the string ${SILENT} and call no tools.`,
  },
  {
    cronExpr: "0 13 * * *",
    label: "LUNCH",
    systemNote:
      "This is the 13:00 LUNCH CHECK-IN. Ask about lunch (calories and protein) unless it is already logged for today. One concise Telegram message. " +
      `If lunch is already logged, reply with exactly the string ${SILENT} and call no tools.`,
  },
  {
    cronExpr: "0 19 * * *",
    label: "DINNER",
    systemNote:
      "This is the 19:00 DINNER CHECK-IN. Ask about dinner (calories and protein) unless it is already logged for today. One concise Telegram message. " +
      `If dinner is already logged, reply with exactly the string ${SILENT} and call no tools.`,
  },
  {
    cronExpr: "30 21 * * *",
    label: "EVENING",
    systemNote:
      "This is the 21:30 EVENING CHECK-IN. Do two things: (1) Write a short daily summary into today's log via write_file, using the convention in protocol.md (slot name: Summary). (2) Ask about evening supplements unless they are already logged for today. Combine the ask into one concise Telegram message. " +
      `If a Summary line is already present in today's log AND evening supplements are already logged, reply with exactly the string ${SILENT} and call no tools.`,
  },
];

/** Returns true if the error looks like a transient Anthropic / network failure worth retrying once. */
const isTransientError = (err: unknown): boolean => {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: number; code?: string; name?: string };
  if (typeof e.status === "number" && e.status >= 500) return true;
  if (e.code === "ECONNRESET" || e.code === "ETIMEDOUT" || e.code === "ECONNREFUSED") return true;
  if (e.name === "APIConnectionError" || e.name === "APIConnectionTimeoutError") return true;
  return false;
};

/** Sleeps for `ms` milliseconds. Kept tiny so we don't pull in a dependency for it. */
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Calls the LLM for one scheduled check-in. On a transient error, waits
 * RETRY_DELAY_MS and tries exactly once more. Any further failure is
 * logged and swallowed — no user-facing message is sent, matching
 * spec1's "no retries" rule for the reminder itself.
 */
const callWithOneRetry = async (
  systemNote: string,
  label: string
): Promise<{ reply: string; usage: { input: number; output: number } } | null> => {
  try {
    return await callTurn({ systemNote });
  } catch (err) {
    if (!isTransientError(err)) {
      console.error(`[scheduler] ${label} failed (non-transient):`, err);
      return null;
    }
    console.warn(`[scheduler] ${label} transient failure, retrying in ${RETRY_DELAY_MS / 1000}s`);
    await sleep(RETRY_DELAY_MS);
    try {
      return await callTurn({ systemNote });
    } catch (retryErr) {
      console.error(`[scheduler] ${label} retry also failed:`, retryErr);
      return null;
    }
  }
};

/**
 * Runs one check-in: call the LLM, decide whether to stay silent,
 * and send to Telegram if there's something to say.
 */
const runCheckIn = async (
  bot: Bot,
  chatId: number,
  checkIn: CheckIn
): Promise<void> => {
  const result = await callWithOneRetry(checkIn.systemNote, checkIn.label);
  if (!result) return;

  const trimmed = result.reply.trim();
  console.log(
    `[scheduler] ${checkIn.label} | tokens: ${result.usage.input}in/${result.usage.output}out | ${trimmed === SILENT || !trimmed ? "silent" : `reply: "${trimmed.slice(0, 60)}"`}`
  );

  if (!trimmed || trimmed === SILENT) return;

  try {
    await bot.api.sendMessage(chatId, trimmed);
  } catch (err) {
    console.error(`[scheduler] ${checkIn.label} sendMessage failed:`, err);
  }
};

/** Registers the four check-in cron jobs and starts them. */
export const startScheduler = (bot: Bot, chatId: number): void => {
  for (const ci of CHECK_INS) {
    cron.schedule(
      ci.cronExpr,
      () => {
        runCheckIn(bot, chatId, ci).catch((err) => {
          console.error(`[scheduler] ${ci.label} handler threw:`, err);
        });
      },
      { timezone: TZ }
    );
    console.log(`[scheduler] ${ci.label} → ${ci.cronExpr} (${TZ})`);
  }
};
