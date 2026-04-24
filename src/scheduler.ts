/**
 * Cron-based check-in scheduler.
 *
 * Runs five fixed jobs per day in Europe/Copenhagen time:
 *   08:30 MORNING         — sleep, morning sups, Shake 1
 *   14:30 SHAKE_2         — Shake 2
 *   17:30 PRE_DINNER      — pre-dinner probiotics
 *   19:30 SHAKE_2_CATCHUP — fires only if Shake 2 still unlogged
 *   21:30 EVENING         — daily summary + evening sups
 *
 * Each job does exactly one thing: hand the LLM a short `systemNote`
 * describing this check-in, then send whatever reply the LLM produces
 * to Telegram (prefixed with a mindfulness cue — see WAKE_PREFIX).
 *
 * The LLM decides what's missing by reading today's daily log and the
 * protocol (both already in the system prompt). If everything is
 * already logged, it returns a reply starting with `<silent>` and we
 * send no Telegram message at all.
 *
 * On transient Claude API failures (5xx or network), each scheduled
 * tick retries exactly once after a 60-second delay before giving up.
 * Non-transient failures (4xx, auth errors, bad model ID) are logged
 * with a distinct message so a recurring config break is visible in
 * the journal rather than looking like a one-off flake.
 */

import cron from "node-cron";
import type { Bot } from "grammy";
import { callTurn } from "./llm.js";

/** Timezone for all cron schedules. */
const TZ = "Europe/Copenhagen";

/**
 * Sentinel the LLM is instructed to return when nothing needs to be
 * asked. We match with `startsWith` so a stray period or trailing
 * explanation after the token still suppresses the Telegram message
 * (the instruction is "reply with exactly `<silent>`" but models
 * sometimes append prose).
 */
const SILENT = "<silent>";

/** Delay before retrying once on a transient API failure. */
const RETRY_DELAY_MS = 60_000;

/**
 * Prefix prepended to every non-silent scheduled message before it's
 * sent to Telegram. A personal mindfulness cue — the first words of
 * every nag snap Jakob out of autopilot.
 *
 * Applied in code (not via the system note) for two reasons:
 *   1. The `<silent>` sentinel is checked BEFORE the prefix is added,
 *      so silent ticks still send nothing — we can't accidentally
 *      leak "Wake up zombie" on a silent reply.
 *   2. The LLM can't forget the prefix, reword it, or double-prefix
 *      it. Deterministic code beats prompt instruction for something
 *      this load-bearing.
 *
 * Only scheduled ticks are prefixed. Conversational replies in `bot.ts`
 * are unaffected.
 */
const WAKE_PREFIX = "Wake up zombie";

/** Shape of one scheduled check-in. */
interface CheckIn {
  readonly cronExpr: string;
  readonly label: string;
  readonly systemNote: string;
}

const CHECK_INS: readonly CheckIn[] = [
  {
    cronExpr: "30 8 * * *",
    label: "MORNING",
    systemNote:
      "This is the 08:30 MORNING CHECK-IN. The protocol and today's log are in the system prompt above. Ask about whatever is still missing from: sleep, morning supplements, Shake 1. Ask in one concise Telegram message. " +
      `If all three are already logged for today, reply with exactly the string ${SILENT} and call no tools. Do not add any text after ${SILENT}.`,
  },
  {
    cronExpr: "30 14 * * *",
    label: "SHAKE_2",
    systemNote:
      "This is the 14:30 SHAKE 2 CHECK-IN. Ask about Shake 2 (slot name: Shake 2) unless it is already logged for today. One concise Telegram message. " +
      `If Shake 2 is already logged, reply with exactly the string ${SILENT} and call no tools. Do not add any text after ${SILENT}.`,
  },
  {
    cronExpr: "30 17 * * *",
    label: "PRE_DINNER",
    systemNote:
      "This is the 17:30 PRE-DINNER CHECK-IN. Ask about pre-dinner supplements (slot name: Pre-dinner supplements — these are probiotics, taken ~30 min before dinner) unless they are already logged for today. One concise Telegram message. " +
      `If pre-dinner supplements are already logged, reply with exactly the string ${SILENT} and call no tools. Do not add any text after ${SILENT}.`,
  },
  {
    cronExpr: "30 19 * * *",
    label: "SHAKE_2_CATCHUP",
    systemNote:
      "This is the 19:30 SHAKE 2 CATCH-UP. This check-in exists only to nudge Jakob if he hasn't logged Shake 2 yet today. " +
      `If Shake 2 (slot name: Shake 2) is already logged for today, reply with exactly the string ${SILENT} and call no tools. Do not add any text after ${SILENT}. ` +
      "Otherwise, ask him about his second shake in one concise Telegram message.",
  },
  {
    cronExpr: "30 21 * * *",
    label: "EVENING",
    systemNote:
      "This is the 21:30 EVENING CHECK-IN. The evening check-in covers two items: a daily summary (slot name: Summary) and evening supplements. " +
      "Step 1: Scan today's log for an existing Summary entry. If none is present, write a short compliance-focused summary into today's log via write_file, using the convention in protocol.md (sleep, which of the three supplement slots landed, shake compliance 2/2 or 1/2 or 0/2, plus any freeform notes). DO NOT overwrite a Summary that is already there. " +
      "Step 2: If evening supplements are not yet logged for today, ask about them in one concise Telegram message. " +
      `If a Summary is already present AND evening supplements are already logged, skip both steps and reply with exactly the string ${SILENT} (and call no tools). Do not add any text after ${SILENT}.`,
  },
];

/**
 * True when the error looks like a transient Anthropic or network
 * failure worth retrying once. Checks three signals in order:
 *   1. HTTP status >= 500 (server-side Anthropic issues).
 *   2. Known Node network error codes (connection reset, timeout, refused).
 *   3. Anthropic SDK error class names for connection-level failures.
 *
 * Non-transient errors (4xx, auth, schema) return false so the
 * scheduler does not waste a retry on a permanent condition.
 */
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
 * Calls the LLM for one scheduled check-in.
 *
 * On a transient error: waits RETRY_DELAY_MS and tries exactly once
 * more. Any further failure is logged and swallowed — no user-facing
 * message is sent, matching spec1's "no retries" rule for the reminder
 * itself.
 *
 * On a non-transient error (4xx, bad model ID, auth): logs with a
 * distinct "(non-transient — not retrying)" tag so a recurring config
 * break is easy to distinguish from a one-off flake when grepping the
 * journal.
 */
const callWithOneRetry = async (
  chatId: number,
  systemNote: string,
  label: string
): Promise<{ reply: string; usage: { input: number; output: number } } | null> => {
  try {
    return await callTurn(chatId, { systemNote });
  } catch (err) {
    if (!isTransientError(err)) {
      console.error(`[scheduler] ${label} failed (non-transient — not retrying):`, err);
      return null;
    }
    console.warn(`[scheduler] ${label} transient failure, retrying in ${RETRY_DELAY_MS / 1000}s`);
    await sleep(RETRY_DELAY_MS);
    try {
      return await callTurn(chatId, { systemNote });
    } catch (retryErr) {
      console.error(`[scheduler] ${label} retry also failed (giving up for this tick):`, retryErr);
      return null;
    }
  }
};

/**
 * Runs one check-in:
 *   1. Ask the LLM what to say (with one-shot retry on transient errors).
 *   2. Trim the reply. Empty reply or anything starting with `<silent>`
 *      means "no Telegram message" — we log and return.
 *   3. Otherwise send the reply to Telegram, wrapping the send call in
 *      its own try/catch so a network error doesn't crash node-cron.
 */
const runCheckIn = async (
  bot: Bot,
  chatId: number,
  checkIn: CheckIn
): Promise<void> => {
  const result = await callWithOneRetry(chatId, checkIn.systemNote, checkIn.label);
  if (!result) return;

  const trimmed = result.reply.trim();
  const isSilent = !trimmed || trimmed.startsWith(SILENT);
  console.log(
    `[scheduler] ${checkIn.label} | tokens: ${result.usage.input}in/${result.usage.output}out | ${isSilent ? "silent" : `reply: "${trimmed.slice(0, 60)}"`}`
  );

  if (isSilent) return;

  const payload = `${WAKE_PREFIX}\n\n${trimmed}`;
  try {
    await bot.api.sendMessage(chatId, payload);
  } catch (err) {
    console.error(`[scheduler] ${checkIn.label} sendMessage failed:`, err);
  }
};

/**
 * Registers the five check-in cron jobs and starts them.
 *
 * For each entry in `CHECK_INS`, registers a cron job in the Copenhagen
 * timezone. The job body wraps `runCheckIn` in a `.catch` so an
 * unexpected throw inside the handler logs rather than crashing the
 * node-cron process. Logs the schedule line at boot so you can see in
 * the journal what the process thinks it's doing.
 */
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
