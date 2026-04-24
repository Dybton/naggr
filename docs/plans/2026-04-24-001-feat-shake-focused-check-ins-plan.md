---
title: "feat: Drop calorie tracking, switch to shake-focused 5-job schedule"
type: feat
status: active
date: 2026-04-24
---

# feat: Drop calorie tracking, switch to shake-focused 5-job schedule

## Overview

Retire calorie/protein meal tracking. Treat the two daily shakes like supplements. Redesign the daily schedule around 5 fixed check-ins instead of 4, add a new pre-dinner probiotics slot, add a conditional catch-up ping for the second shake at 19:30, and prefix every scheduled message with `Wake up zombie` as a mindfulness cue.

Two files change: `protocol.md` (the behavioral spec the LLM reads every turn) and `src/scheduler.ts` (the cron jobs and per-check-in system notes). No new dependencies, no schema changes, no test-suite additions beyond existing smoke tests.

## Problem Frame

The current 4-check-in schedule was built around meal tracking — lunch at 13:00 and dinner at 19:00 exist mainly to capture calorie/protein numbers. Jakob doesn't do that tracking, so those check-ins generate nagging without value.

What does matter: getting two big protein shakes down per day (treat them like medicine), taking morning supplements, taking probiotics 30 minutes before dinner, and taking evening supplements. A schedule organized around supplements + shakes — not meals — fits the actual behavior to change.

The `Wake up zombie` prefix is a personal mindfulness cue: Jakob wants every scheduled nag to start with those three words so the first line of every Telegram notification snaps him out of autopilot.

## Requirements Trace

- R1. Remove calorie / macro tracking from protocol and schedule.
- R2. Track 2 shakes per day as first-class items, like supplements.
- R3. Move morning check-in from 09:00 to 08:30 and fold Shake 1 into it.
- R4. Add a 14:30 check-in reminding about Shake 2.
- R5. Add a 17:30 check-in reminding about pre-dinner probiotics.
- R6. Add a conditional 19:30 check-in that fires only if Shake 2 is still unlogged.
- R7. Keep the 21:30 evening check-in (evening supplements + compliance-focused daily summary).
- R8. Every scheduled message starts with `Wake up zombie`. Conversational replies are unchanged.
- R9. Preserve the existing `<silent>` sentinel behavior — if nothing is missing, the bot stays silent.

## Scope Boundaries

- Conversational replies (user-initiated turns via `bot.ts`) are **not** prefixed with `Wake up zombie`.
- No database, no migrations, no new tool calls, no new dependencies.
- `SOUL.md` stays unchanged — persona tone is fine as-is.
- Existing daily logs (e.g. `daily/2026-04-23.md` and earlier) are not rewritten. The new slot names take effect going forward.
- No changes to `bot.ts`, `llm.ts`, `voice.ts`, `paths.ts`, or `daily-path.ts`.

### Deferred to Separate Tasks

- None.

## Context & Research

### Relevant Code and Patterns

- [src/scheduler.ts](src/scheduler.ts) — the `CHECK_INS` array. Each entry is `{ cronExpr, label, systemNote }`. The file already documents the pattern clearly in its top JSDoc. All new check-ins follow the same shape.
- [src/llm.ts](src/llm.ts) — `buildSystemPrompt` stitches protocol.md + today's log + rules into every turn. The `<silent>` detection lives in `src/scheduler.ts` around line 155 (`trimmed.startsWith(SILENT)`).
- [protocol.md](protocol.md) — current supplement sections, scheduled check-in table, and "Writing convention for today's daily log" slot list. All three sections need edits.
- [src/index.ts](src/index.ts) — `startScheduler(bot, chatId)` is called once at boot. No changes here; the function signature stays the same.

### Institutional Learnings

- [docs/solutions/best-practices/llm-driven-state-over-regex-parsing-2026-04-18.md](docs/solutions/best-practices/llm-driven-state-over-regex-parsing-2026-04-18.md) — the LLM reads freeform markdown to decide state; no regex, no parser. New slot names (`Shake 1`, `Shake 2`, `Pre-dinner supplements`) are added to the slot list in `protocol.md` and the LLM naturally scans for them. No code in `src/` inspects slot contents.

### External References

- None needed. Change is contained to config and prompt text.

## Key Technical Decisions

- **Prefix `Wake up zombie` in code, after the silence check — not in the system note.** The scheduler already runs `trimmed.startsWith("<silent>")` to decide whether to send. We do that check first, then prepend `Wake up zombie\n\n` to non-silent replies before calling `sendMessage`. Rationale: if the instruction lived only in the system note, the LLM could forget, produce the prefix inside a `<silent>` reply, or double-prefix it. Code-side prepend is deterministic and keeps the LLM's silence sentinel intact.
- **Keep the schedule in a single `CHECK_INS` array.** The existing pattern scales to 5 entries with no restructuring. Introducing classes or config files would add ceremony for a one-line-per-entry change.
- **Use explicit slot names `Shake 1` and `Shake 2` in the daily log.** The LLM counts slot occurrences to decide compliance; two distinct names are unambiguous. `Morning shake` / `Afternoon shake` was considered but rejected — if Jakob ever shifts his second shake to late morning, the naming would go stale.
- **The 19:30 catch-up is a separate cron entry, not a modifier on 14:30.** Each cron tick independently asks the LLM "is Shake 2 logged?" and stays silent if yes. Simple, matches every other entry in the array.
- **Drop the 13:00 and 19:00 meal check-ins entirely.** With meal tracking gone, there's nothing to ask. A "how was lunch" freeform check-in would drift into the very meal-logging friction we're removing.

## Open Questions

### Resolved During Planning

- Meal tracking scope → Drop all meal tracking entirely. No breakfast/lunch/dinner logging on any schedule.
- Pre-dinner supplements → Probiotics, taken 30 minutes before dinner. Labeled `Pre-dinner supplements` in protocol + daily log.
- Prefix scope → Scheduled reminders only. Conversational replies unchanged.
- 19:30 rule → Fires only if Shake 2 unlogged. Shake 1 status is irrelevant at 19:30.
- Shake slot naming → `Shake 1` and `Shake 2`.
- Evening summary → Keep. Compliance-focused (sleep, 3 sup slots, 2 shake slots, plus freeform notes).

### Deferred to Implementation

- Exact wording of each `systemNote` string — will settle during the edit. The **shape** of each note is specified per unit below.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

**Daily timeline (Europe/Copenhagen):**

```
08:30  MORNING          ask about: sleep, morning sups, Shake 1
14:30  SHAKE_2          ask about: Shake 2
17:30  PRE_DINNER       ask about: pre-dinner probiotics
19:30  SHAKE_2_CATCHUP  silent unless Shake 2 still missing
21:30  EVENING          write Summary if missing, ask about evening sups
```

**Message flow for every scheduled tick:**

```
cron fires
  └── runCheckIn(bot, chatId, checkIn)
        └── callWithOneRetry → LLM turn
              └── LLM reads protocol.md + today's log
              └── returns either "<silent>..." or a short message
        └── if startsWith("<silent>")  → log + return, no send
        └── else                        → prepend "Wake up zombie\n\n" + send
```

**Daily log slot names the LLM scans for compliance:**

```
Sleep
Morning supplements
Shake 1
Shake 2
Pre-dinner supplements
Evening supplements
Summary
```

## Implementation Units

- [ ] **Unit 1: Rewrite `protocol.md` for 5-check-in, shake-focused schedule**

**Goal:** Update the behavioral spec the LLM reads every turn so it knows about the new schedule, the two shakes, pre-dinner probiotics, and the new slot names. Remove calorie/protein targets and meal-related content.

**Requirements:** R1, R2, R3, R4, R5, R6, R7, R9.

**Dependencies:** None.

**Files:**
- Modify: `protocol.md`

**Approach:**
- **Diet section:** Remove the `Daily target: ~3500 kcal, ~180g protein` line. Remove the `Meals: 3 main + 1–2 snacks` line. Replace with a short two-line summary: "High-protein, anti-inflammatory" and a pointer to the shakes section.
- **New `Shakes` section (above Supplements):** "Two large protein shakes per day. Treat them like supplements — non-negotiable. Shake 1 with morning supplements. Shake 2 by 14:30, with a catch-up nudge at 19:30 if still unlogged."
- **Supplements section:** Keep `Morning` as-is but add a bullet noting Shake 1 is part of the morning routine. Add a new `Pre-dinner (17:30, ~30 min before dinner)` subsection listing probiotics. Keep `Evening (21:00 / wind-down)` unchanged.
- **Scheduled check-ins table:** Replace the 4-row table with a 5-row table matching the new timeline above. Note the 19:30 row as "Silent unless Shake 2 is not logged".
- **Writing convention / slot list:** Add `Shake 1`, `Shake 2`, `Pre-dinner supplements` to the slot list at the bottom. Remove `Breakfast`, `Lunch`, `Dinner` from the slot list. Update the example log to remove meal entries and add two shake entries and a pre-dinner supplement entry.
- Keep everything else in `protocol.md` (Identity & Goals, Sleep section) untouched.

**Patterns to follow:**
- Current section headings and example-log style in `protocol.md`. Match voice and indentation.

**Test scenarios:**
- Happy path: After the edit, re-read `protocol.md` manually and confirm the 5-row check-in table matches the timeline. Confirm `Shake 1`, `Shake 2`, `Pre-dinner supplements` appear in the slot list. Confirm no `Breakfast` / `Lunch` / `Dinner` / `kcal` / `protein` strings remain (search with Grep).
- Test expectation: none (automated) — this is prompt content. Verification is visual + grep for removed strings.

**Verification:**
- `Grep` for `kcal` and `protein` in `protocol.md` returns zero hits.
- `Grep` for `Shake 1`, `Shake 2`, `Pre-dinner supplements` each returns at least one hit.
- The check-in table has 5 rows with times `08:30`, `14:30`, `17:30`, `19:30`, `21:30`.

---

- [ ] **Unit 2: Rewrite `CHECK_INS` array in `src/scheduler.ts` for 5 jobs**

**Goal:** Replace the 4-entry `CHECK_INS` array with a 5-entry version. Each entry has a new cron expression, a new label, and a system note that tells the LLM what to ask or when to stay silent.

**Requirements:** R1, R3, R4, R5, R6, R7, R9.

**Dependencies:** Unit 1 (the system notes reference slot names defined in `protocol.md`).

**Files:**
- Modify: `src/scheduler.ts`

**Approach:**

Replace the existing `CHECK_INS` entries with these 5, in this order (each keeps the existing `{ cronExpr, label, systemNote }` shape):

| Cron | Label | System note asks about |
|------|-------|------------------------|
| `30 8 * * *` | `MORNING` | Sleep, morning supplements, Shake 1 |
| `30 14 * * *` | `SHAKE_2` | Shake 2 |
| `30 17 * * *` | `PRE_DINNER` | Pre-dinner supplements (probiotics) |
| `30 19 * * *` | `SHAKE_2_CATCHUP` | Shake 2 *only if still unlogged* — otherwise silent |
| `30 21 * * *` | `EVENING` | Daily Summary (write if missing) + evening supplements |

- Every non-EVENING note follows the same shape: "This is the HH:MM <LABEL> CHECK-IN. Ask about X unless already logged. One concise message. If already logged, reply with exactly `<silent>` and call no tools."
- The `EVENING` note keeps its current two-step shape (write Summary if missing, then ask about evening supplements), just with the summary now being compliance-focused (supplements + shakes + sleep + freeform notes) per the updated `protocol.md`. The existing note already delegates to `protocol.md` for slot naming, so the prose shouldn't need to change much.
- The `SHAKE_2_CATCHUP` note is simpler than most: "This is the 19:30 SHAKE 2 CATCH-UP. If `Shake 2` is already logged for today, reply with exactly `<silent>`. Otherwise ask Jakob about his second shake in one concise message."
- **Do not** change `RETRY_DELAY_MS`, the `isTransientError` helper, `callWithOneRetry`, or `startScheduler` signature. Only the `CHECK_INS` array changes.

**Patterns to follow:**
- Existing `CHECK_INS` entries in `src/scheduler.ts`. Match style: `readonly` array, consistent use of the `SILENT` constant via string interpolation in each note.

**Test scenarios:**
- Happy path: `npm run start` (or `dev`) boots without errors and the startup log shows 5 lines of the form `[scheduler] MORNING → 30 8 * * * (Europe/Copenhagen)` etc.
- Integration: With today's daily log containing `## 14:35 Shake 2: ...`, manually trigger the 19:30 check-in (or wait) — the LLM returns `<silent>` and no Telegram message is sent. Remove the Shake 2 entry and re-run — a nudge is sent.
- Edge case: A cron expression typo (e.g. `30 8 *` instead of `30 8 * * *`) would make `node-cron` throw at registration. Verify boot logs show 5 successful `cron.schedule` calls.
- Test expectation: none (automated) beyond existing `npm run verify` — behavior is end-to-end via Telegram. No unit test exists for `CHECK_INS` today and adding one would mostly test our own constant, not behavior.

**Verification:**
- Boot logs show exactly 5 scheduler lines in the expected order and times.
- Manual Telegram ping at each check-in time produces (a) the expected question, or (b) no message when silence is warranted.

---

- [ ] **Unit 3: Prefix scheduled messages with `Wake up zombie` in `runCheckIn`**

**Goal:** After the LLM returns a non-silent reply for a scheduled check-in, prepend `Wake up zombie\n\n` to the message before sending. Silent replies are untouched.

**Requirements:** R8, R9.

**Dependencies:** None (can land in parallel with Unit 2, but safer to do it after so the smoke test in Unit 2 sees the real message shape).

**Files:**
- Modify: `src/scheduler.ts`

**Approach:**
- Add a module-level constant: `const WAKE_PREFIX = "Wake up zombie";`.
- In `runCheckIn`, after the existing silence check (`if (isSilent) return;`) and before `bot.api.sendMessage(chatId, trimmed)`, prepend the prefix. Example shape: `const payload = \`${WAKE_PREFIX}\n\n${trimmed}\`;` then send `payload`.
- Do **not** prefix in `bot.ts` — conversational replies stay clean.
- Do **not** prefix inside the system notes — the LLM must not know about the prefix, so it can't accidentally duplicate it.
- If the LLM ever happens to include `Wake up zombie` itself at the start of `trimmed`, we still prepend — a double prefix is a minor cosmetic issue, not a correctness bug, and "LLM starts its reply with those words" is unlikely given it isn't instructed to. Not worth adding string-inspection logic.

**Patterns to follow:**
- Existing structure in `runCheckIn` — keep the function small, keep the `try/catch` around `sendMessage`.

**Test scenarios:**
- Happy path: Trigger a scheduled check-in with an empty daily log. Telegram message arrives starting with `Wake up zombie` on its own line, then a blank line, then the LLM's question.
- Edge case: LLM returns `<silent>`. No message is sent; no prefix is leaked anywhere.
- Edge case: User messages the bot directly at 15:00 ("took my shake"). Bot's conversational reply does **not** contain `Wake up zombie` — only the scheduled ticks are prefixed.
- Error path: `sendMessage` throws (network error). The existing `try/catch` logs and swallows. Prefix handling doesn't change that flow.

**Verification:**
- Trigger at least one scheduled check-in in development and confirm the Telegram message starts with `Wake up zombie\n\n`.
- Send a text message to the bot and confirm its reply does *not* start with `Wake up zombie`.

---

- [ ] **Unit 4: Manual end-to-end smoke test and daily-log verification**

**Goal:** Confirm the new schedule behaves end-to-end in the real deployed environment over one full day. This is a human-in-the-loop verification, not a code change.

**Requirements:** R1–R9.

**Dependencies:** Unit 1, 2, 3.

**Files:** None.

**Approach:**
- Deploy to the existing Hetzner/systemd target as usual (no deployment changes in this plan).
- Over the course of one day, observe that each scheduled time fires, the bot asks the right question, and `Wake up zombie` leads every scheduled message.
- At the end of the day, read `daily/YYYY-MM-DD.md` and confirm the logged slots are the new ones (`Shake 1`, `Shake 2`, `Pre-dinner supplements`, etc.) — no `Breakfast` / `Lunch` / `Dinner` / `kcal` / `protein` entries.
- Optionally: intentionally log `Shake 2` before 19:30 and confirm the 19:30 tick stays silent (check the journal for `[scheduler] SHAKE_2_CATCHUP | ... | silent`).

**Patterns to follow:**
- Existing deployment and journal-reading workflow. `journalctl -u naggr -f` during the day.

**Test scenarios:**
- Happy path: 08:30 ping arrives with `Wake up zombie` prefix, asks about sleep + morning sups + Shake 1.
- Happy path: 14:30 ping asks about Shake 2.
- Happy path: 17:30 ping asks about pre-dinner probiotics.
- Happy path: 21:30 ping writes a Summary entry and asks about evening sups.
- Edge case: If `Shake 2` logged before 19:30, 19:30 stays silent.
- Edge case: If `Shake 2` not logged by 19:30, 19:30 asks about it.
- Edge case: If Jakob logs everything early (e.g. all slots before 08:30), the 08:30, 14:30, 17:30 pings stay silent. The 21:30 ping still writes a Summary if none exists, then checks evening sups.

**Verification:**
- One full day of journal lines showing either real messages (each prefixed) or `| silent` as appropriate.
- Today's daily log file at end of day contains only the new slot names.

## System-Wide Impact

- **Interaction graph:** Only `src/scheduler.ts` and `protocol.md` change. `bot.ts`, `llm.ts`, `voice.ts`, `paths.ts`, `daily-path.ts`, `storage/persona.ts`, and `scripts/verify-parse.ts` are untouched. No change to exported function signatures.
- **Error propagation:** Unchanged. The existing `isTransientError` / one-shot retry flow in `callWithOneRetry` and the `try/catch` around `sendMessage` keep working. Prefix handling adds no new failure modes.
- **State lifecycle risks:** The per-chat mutex (`withChatLock` in `src/llm.ts`) already serialises writes to today's daily log, so a 14:30 user-initiated "took my shake" turn and the 14:30 cron tick don't race. No new race surface introduced.
- **API surface parity:** No external API changes. The Telegram sending surface is identical; only the content of scheduled messages changes.
- **Integration coverage:** Covered by Unit 4's one-day real-world smoke test. There are no unit tests for `CHECK_INS` today and adding them would mostly test our own constants rather than behavior, so the manual soak is the right bar.
- **Unchanged invariants:**
  - `<silent>` sentinel still suppresses outbound Telegram messages (checked **before** the prefix is applied).
  - `startScheduler(bot, chatId)` signature unchanged; `src/index.ts` boot path untouched.
  - Daily file location (`daily/YYYY-MM-DD.md`) and tool surface (`read_file` / `write_file`) unchanged.
  - Prior daily logs are not rewritten or migrated.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| LLM fails to notice a freshly renamed slot in `protocol.md` and keeps asking about a slot that's already logged under its new name. | `protocol.md` is authoritative and re-read every turn. One-day soak (Unit 4) catches drift. If it happens, tighten the slot list in `protocol.md`. |
| The code-side prefix accidentally lands on a `<silent>` reply. | The silence check happens **before** the prefix is prepended. Unit test scenarios in Unit 3 exercise the silent path. |
| `Wake up zombie` feels jarring attached to a warm-coach tone after a week. | Prefix is deterministic and one-line to remove — `WAKE_PREFIX = ""` or delete the prepend. Low reversal cost. |
| 19:30 catch-up fires even though Jakob chose to skip shake 2 intentionally that day. | Matches user intent — nagging is the whole point. If this gets noisy, it's trivial to add a "skip the rest of today" mechanism later, but that's scope for a separate change. |
| An old journal or user expectation still assumes 09:00 / 13:00 / 19:00. | Deployment log at boot shows the 5 new cron lines plainly; Jakob will see them on the next `journalctl` check. |

## Documentation / Operational Notes

- No separate docs or runbooks to update beyond `protocol.md` itself.
- No feature flag. This is a personal, single-user bot — ship as one commit.
- No migration of existing daily logs. New slot names take effect going forward.

## Sources & References

- Related code:
  - [src/scheduler.ts](src/scheduler.ts) — the `CHECK_INS` array, `runCheckIn`, `startScheduler`.
  - [src/llm.ts](src/llm.ts) — `buildSystemPrompt` (how `protocol.md` reaches the LLM) and `withChatLock` (race safety).
  - [protocol.md](protocol.md) — the behavioral spec being rewritten.
- Related prior plan: [docs/plans/2026-04-18-001-refactor-naggr-simplification-plan.md](docs/plans/2026-04-18-001-refactor-naggr-simplification-plan.md) — established the stateless, LLM-driven pattern this plan builds on.
- Related learning: [docs/solutions/best-practices/llm-driven-state-over-regex-parsing-2026-04-18.md](docs/solutions/best-practices/llm-driven-state-over-regex-parsing-2026-04-18.md) — confirms that adding new slots is a prompt-only change, no code parsing required.
