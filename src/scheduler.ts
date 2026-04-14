/**
 * Cron-based reminder scheduler.
 * Runs five fixed jobs (morning supplements, lunch, dinner, evening, daily summary)
 * in Europe/Copenhagen timezone. Each job reads today's daily log to check if the
 * item is already done before calling the LLM. Unanswered reminders get one
 * follow-up after 30 min.
 */

import cron from "node-cron";
import type { Bot } from "grammy";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { callTurn } from "./llm.js";

const DATA_DIR = join(__dirname, "..");
const DAILY_DIR = join(DATA_DIR, "daily");

/** Returns today's date as YYYY-MM-DD in Copenhagen timezone. */
const todayStr = (): string =>
  new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Copenhagen" });

/** Reads today's daily log as raw text. Returns empty string if missing. */
const readTodayLog = (): string => {
  const path = join(DAILY_DIR, `${todayStr()}.md`);
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf-8");
};

interface ReminderConfig {
  cronExpr: string;
  type: string;
  check: () => boolean;
  systemNote: string | (() => string);
}

/** Registers all five cron jobs and starts them. Each job fires a reminder only if the relevant item isn't already logged. */
export const startScheduler = (
  bot: Bot,
  jakobChatId: number,
  laerkeChatId?: number
): void => {
  const tz = "Europe/Copenhagen";

  const reminders: ReminderConfig[] = [
    {
      cronExpr: "0 9 * * *",
      type: "SUPPLEMENT_REMINDER",
      check: () => {
        const log = readTodayLog();
        // Check if all morning supplements are marked [x]
        const morningSupps = ["Omega-3", "Vitamin D3", "Zinc", "Magnesium glycinate"];
        return morningSupps.every((name) =>
          new RegExp(`\\[x\\].*${name}`, "i").test(log)
        );
      },
      systemNote:
        "This is a scheduled MORNING SUPPLEMENT REMINDER. The user hasn't taken their morning supplements yet. Generate one short reminder in your normal voice.",
    },
    {
      cronExpr: "0 13 * * *",
      type: "MEAL_CHECKIN",
      check: () => {
        const log = readTodayLog();
        return /### Lunch/i.test(log);
      },
      systemNote: () => {
        const log = readTodayLog();
        const kcalMatch = log.match(/Calories:\s*~(\d+)/);
        const current = kcalMatch ? parseInt(kcalMatch[1]) : 0;
        const pace = 1400; // ~40% of 3500 by lunch
        let note = "This is a scheduled LUNCH CHECK-IN. Ask what the user had for lunch if not logged yet. Generate one short message in your normal voice.";
        if (current < pace * 0.7) {
          note += ` The user is at ${current}/3500 kcal by 12:30 — significantly behind pace (should be ~${pace}). Gently suggest eating more, in character.`;
        }
        return note;
      },
    },
    {
      cronExpr: "0 18 * * *",
      type: "MEAL_CHECKIN",
      check: () => {
        const log = readTodayLog();
        return /### Dinner/i.test(log);
      },
      systemNote: () => {
        const log = readTodayLog();
        const kcalMatch = log.match(/Calories:\s*~(\d+)/);
        const current = kcalMatch ? parseInt(kcalMatch[1]) : 0;
        const pace = 2450; // ~70% of 3500 by dinner
        let note = "This is a scheduled DINNER CHECK-IN. Ask what the user had for dinner if not logged yet. Generate one short message in your normal voice.";
        if (current < pace * 0.7) {
          note += ` The user is at ${current}/3500 kcal by 18:00 — significantly behind pace (should be ~${pace}). Gently suggest eating more, in character.`;
        }
        return note;
      },
    },
    {
      cronExpr: "0 21 * * *",
      type: "DAILY_SUMMARY",
      check: () => {
        const log = readTodayLog();
        // Don't summarize if no meals were logged
        return !/### /i.test(log);
      },
      systemNote:
        "This is the END OF DAY summary. Read today's daily log, then send a brief summary (max 5-6 lines). Also create tomorrow's daily log using write_file if it doesn't exist.",
    },
    {
      cronExpr: "30 21 * * *",
      type: "SUPPLEMENT_REMINDER",
      check: () => {
        const log = readTodayLog();
        return /\[x\].*Chemo/i.test(log);
      },
      systemNote:
        "This is a scheduled EVENING REMINDER. The user hasn't taken their evening chemo + magnesium yet. Generate one short reminder in your normal voice.",
    },
  ];

  for (const reminder of reminders) {
    cron.schedule(
      reminder.cronExpr,
      async () => {
        try {
          await fireReminder(bot, jakobChatId, reminder);
        } catch (err) {
          console.error(`[scheduler] ${reminder.type} failed:`, err);
        }
      },
      { timezone: tz }
    );
    console.log(`[scheduler] ${reminder.type} → ${reminder.cronExpr} (${tz})`);
  }
};

/** Sends a reminder if the item isn't done yet. Schedules a single 30-min follow-up for non-summary reminders. */
const fireReminder = async (
  bot: Bot,
  jakobChatId: number,
  reminder: ReminderConfig
): Promise<void> => {
  if (reminder.check()) {
    console.log(`[scheduler] ${reminder.type}: already done, skipping`);
    return;
  }

  // Check tapering from AGENTS.md
  const agentsPath = join(DATA_DIR, "AGENTS.md");
  const agents = existsSync(agentsPath) ? readFileSync(agentsPath, "utf-8") : "";
  const missedMatch = agents.match(/Missed reminders:\s*(\d+)/);
  const missed = missedMatch ? parseInt(missedMatch[1]) : 0;

  let note =
    typeof reminder.systemNote === "function"
      ? reminder.systemNote()
      : reminder.systemNote;

  if (missed >= 3) {
    note += `\nTapering is active (${missed} missed). Use the "I'm here when you need me" tone. Be very brief.`;
  } else if (missed >= 2) {
    note += `\nUser missed ${missed} recent reminders. Use a softer "no pressure" tone.`;
  }

  const { reply, usage } = await callTurn(
    [{ role: "user", content: "." }],
    note
  );
  console.log(
    `[scheduler] ${reminder.type} | tokens: ${usage.input}in/${usage.output}out`
  );

  await bot.api.sendMessage(jakobChatId, reply);

  // Schedule follow-up check in 30 minutes (not for daily summary)
  if (reminder.type !== "DAILY_SUMMARY") {
    setTimeout(async () => {
      try {
        if (reminder.check()) {
          console.log(`[scheduler] ${reminder.type} follow-up: now done, skipping`);
          return;
        }

        const followUpNote = `This is a FOLLOW-UP. The user didn't respond to the first ${reminder.type} reminder 30 min ago. Send one gentle nudge, respect tapering level. Do not send further reminders.`;
        const { reply: followUp, usage: followUpUsage } = await callTurn(
          [{ role: "user", content: "." }],
          followUpNote
        );
        console.log(
          `[scheduler] ${reminder.type} follow-up | tokens: ${followUpUsage.input}in/${followUpUsage.output}out`
        );

        await bot.api.sendMessage(jakobChatId, followUp);
      } catch (err) {
        console.error(`[scheduler] ${reminder.type} follow-up failed:`, err);
      }
    }, 30 * 60 * 1000);
  }
};
