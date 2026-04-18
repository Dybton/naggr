---
date: 2026-04-17
topic: state-persistence
focus: Replace regex-based state detection in scheduler with typed, tool-driven state store
---

# Ideation: Robust State & Persistence for Naggr

## Codebase Context

Naggr is a Node.js/TypeScript Telegram bot that nags a single user (Jakob) about supplements, meals, and sleep. Today:

- **Storage:** `daily/YYYY-MM-DD.md` holds freeform markdown (meals, supplement checklist with `[x]`/`[ ]`, running totals, notes). Cross-day state (streaks, missed-reminder count, tapering level) lives as prose in `AGENTS.md`.
- **Scheduler (`src/scheduler.ts`):** 5 cron jobs in Europe/Copenhagen tz. Each job runs regex against today's markdown to decide skip vs fire. Fragile patterns: `### Lunch\s*\n([\s\S]*?)(?=\n##|$)` checking for a `(not logged)` placeholder, `\[x\].*${name}` per supplement, `Calories:\s*~(\d+)`, `Missed reminders:\s*(\d+)`.
- **LLM writes markdown freeform** via a `write_file` tool. Skills (`log-food`, `log-supplement`) prescribe format in prose, but LLM drift causes both false nags (regex misses logged items) and silent skips (regex thinks something is done when it isn't).

User preferences (from `~/.claude/CLAUDE.md`): arrow functions, no `any`, no `reduce`, Zod-validate LLM output, "don't parse what you can prompt" — let LLMs edit markdown; use deterministic code for I/O, scheduling, and schemas.

## Decisions Locked In

- Markdown captures CONTENT (what was eaten, which supplements, sleep details); LLM keeps writing it.
- Per-day JSON captures REPORT FLAGS only (was breakfast reported? was morning check-in done?).
- LLM mutates flags via typed tools. **No regex anywhere.**
- Delete existing `daily/*.md` files and start fresh.
- Scope covers both daily state and cross-day state (`AGENTS.md` counters).

## Recommended MVP

**#1 + #2 + #4 + sleep-as-its-own-slot from #5.**

Rationale: kills every regex in `src/scheduler.ts`, replaces the stringified "behind pace" nudge with a typed context object, makes scheduler decisions testable and explainable, and avoids refactoring the 09:00 cron block twice by pulling sleep into its own flag now. Low total complexity. Defer #5's skip/snooze and #6's registry until real friction appears.

## Ranked Ideas

### 1. Per-day flags JSON + memory.json, Zod-typed, timestamps not booleans
**Description:** `daily/YYYY-MM-DD.json` (Zod-validated) holds `{breakfast_reported, lunch_reported, dinner_reported, morning_supps_reported, evening_chemo_reported, sleep_reported, summary_sent}` — each a nullable ISO timestamp, not a boolean. A separate `memory.json` holds cross-day state (streak, missed_count, tapering_level, last_active_at). LLM mutates both via typed tools (`mark_reported(slot)`, `bump_streak(kind)`, `set_tapering(level)`). AGENTS.md keeps prose only.
**Rationale:** Directly eliminates every regex in `src/scheduler.ts` — `mealLogged`, `/\[x\].*${name}/i`, `/Calories:\s*~(\d+)/`, `/Missed reminders:\s*(\d+)/`. Timestamps (not booleans) let scheduler ask "reported in last 4h?" and survive late-night / midnight edge cases. Matches the `CLAUDE.md` rule on Zod-validating LLM output.
**Downsides:** Two writers per log event (content→md, flag→json). Day-rollover race if an 00:05 meal hits the wrong file. Schema evolution requires a migration habit.
**Confidence:** 92%
**Complexity:** Low
**Status:** Explored — selected for brainstorm handoff

### 2. Structured context into LLM turns (replaces stringified nudges)
**Description:** Scheduler stops concatenating `note += ` based on regex-parsed kcal. Instead it builds a typed `TurnContext = {kcal_so_far, kcal_target, pace_ratio, missed_slots_today, tapering_level}` from the JSON state and passes it into `callTurn` alongside the systemNote. `log_meal({slot, kcal, protein, carbs, fat})` keeps totals in JSON — the scheduler never parses totals from prose again.
**Rationale:** Removes the last remaining regex cluster (the `Calories:~(\d+)` parse + the hand-stitched "behind pace" strings in `scheduler.ts` lines 87–113). Nudge phrasing stays the LLM's job; the numbers stay deterministic.
**Downsides:** Protein/kcal estimates still come from the LLM, just carried deterministically. `log_meal` tool has to stay in sync with the markdown content writer.
**Confidence:** 88%
**Complexity:** Low
**Status:** Unexplored

### 3. Event log as foundation (alternative to #1's flags)
**Description:** Replace mutable flags with an append-only `daily/YYYY-MM-DD.events.jsonl` of typed events (`meal_reported`, `supplement_taken`, `slot_skipped`, `reminder_fired`, `user_replied`). Flags become a pure fold over events; streaks and tapering are derived on read from the N-day window.
**Rationale:** Eliminates the entire class of "mutable counter drift" bugs in `AGENTS.md`. Corrections are compensating events, not in-place edits. Free audit trail answers "why did it nag me?". Tapering auto-recovers when Jakob becomes responsive without anyone remembering to decrement.
**Downsides:** Bigger reframe than the decided path. JSONL harder to hand-inspect than a single flag file. Harder to teach the LLM an "append event" mental model vs. "flip flag".
**Confidence:** 75% (genuine architectural alternative to #1; user chose #1)
**Complexity:** Medium
**Status:** Rejected in favor of #1 for simplicity; revisit if audit/replay becomes valuable

### 4. Dry-run CLI + decision log + in-memory test harness
**Description:** `npm run naggr:dry-run -- --at "2026-04-17T13:00"` loads a day's state and prints which reminders would fire with the exact structured context — no LLM call, no Telegram send. Every real tick writes a structured decision log line (`{tick, reminderId, stateSnapshot, decision, reason}`). Vitest harness seeds a virtual clock + in-memory state, advances time, asserts which tools fire.
**Rationale:** Would have caught the regex drift bugs that prompted this ideation. Makes the scheduler a pure function of `(state, now) → decision`. Every future nag gets a ~10-line regression test instead of waiting-for-13:00-to-see. Decision log answers "why didn't it nag me?" without guessing.
**Downsides:** Requires designing the decision function to be pure first (pairs with #1). Another subcommand in `package.json` to maintain.
**Confidence:** 85%
**Complexity:** Low
**Status:** Unexplored

### 5. Slot state machine with skip/snooze + sleep as first-class slot
**Description:** Each slot has a state: `pending | nagged_once | reported | skipped_by_user`. Tools: `skip_slot("lunch", reason?)` (Jakob says he's fasting), `snooze_slot("morning_supps", "+2h")`. The 30-min follow-up currently in `setTimeout` moves to `nagged_once` state in JSON — survives a restart. Sleep gets its own slot instead of being conflated with the 09:00 supplement reminder's systemNote. `reminder_fired` events give idempotency so restarts/duplicate dispatches don't double-nag.
**Rationale:** Handles real friction ("skip lunch today") without the LLM lying. Fixes the in-memory `setTimeout` restart bug. Separates sleep from morning supplements (currently merged in one 09:00 prompt with no distinct state). Idempotency fence prevents the "two-process briefly" double-nag.
**Downsides:** More moving parts than just booleans. Needs a state-transition table that stays in sync with reminder config.
**Confidence:** 80%
**Complexity:** Medium
**Status:** Partially adopted — sleep-as-its-own-slot pulled into MVP; skip/snooze deferred until real friction

### 6. Config-driven reminder registry + flag-predicate DSL
**Description:** One `reminders.config.ts` (Zod-validated) lists each reminder: `{id, cronExpr, suppressWhen: predicate, fireContext: stateReader, skillRef}`. `src/scheduler.ts` becomes a generic loop over the registry. Predicates compose: `and(notReported("lunch"), afterLocalTime("13:00"))`.
**Rationale:** Today "what reminders exist" is duplicated across 5 hand-coded cron blocks, skill prose, and AGENTS.md prose — drift is guaranteed. A registry collapses all three into one source of truth. Predicates are unit-testable pure functions that compose with the test harness from #4.
**Downsides:** YAGNI at 5 reminders for one user. Every abstraction layer is one more thing to learn if someone else touches the code. Payoff only materializes if more nag types get added.
**Complexity:** Medium
**Status:** Deferred — add on the third new nag, not sooner

## Rejection Summary

| # | Idea | Reason Rejected |
|---|------|-----------------|
| I1 | In-memory map rebuilt from chat history on boot | Bot restart loses state mid-day; doesn't remove JSON need |
| I2 / A6 | Telegram chat as the database | Message history unreliable across long periods; rate limits |
| I3 / A10 | LLM gate replaces flag check | Contradicts explicit goal: "avoid too many LLM calls" |
| I5 | Implicit flags from file mtime / section presence | Fragile — breaks on any non-logging edit, sync, git touch |
| I6 | YAML frontmatter parsed into state | User directive: don't parse markdown into schemas |
| I7 | Reactive scheduler (no cron) | Jakob sometimes goes silent — push required |
| I8 | today.md + archive rotation | Rotation complexity without eliminating regex |
| I10 | Telegram inline-button acks | Big UX change; doesn't solve the state problem itself |
| I11 | Hash-dedup send-always | Spammy; Telegram edit semantics awkward for nags |
| A1 / A12 | Rolling window / waking-period unit | Contradicts per-day JSON decision; adds complexity |
| A3 | LLM decides on every tick | Same "avoid LLM calls" anti-goal |
| A4 | LLM schedules its own wake-ups via tool | setTimeout queue fragile on restart; over-engineering |
| A9 | Two-LLM pipeline (prose → normalizer) | Second model call for marginal benefit |
| L7 | Multi-user path prefix | YAGNI — confirmed single user |
| L9 | Generate skills from protocol.md | User directive: don't parse markdown into schemas |
| L12 | DailyStore pluggable backend | YAGNI — one server, one user |
| P9 | Intent classifier as pre-LLM step | Second model call; marginal token savings |
