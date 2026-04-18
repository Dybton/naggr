---
date: 2026-04-17
topic: state-persistence
---

# Naggr State & Persistence Rewrite

## Problem Frame

Naggr's scheduler currently decides whether to fire a reminder by running regex against freeform markdown the LLM wrote minutes earlier. Patterns like `/\[x\].*${name}/i`, `/Calories:\s*~(\d+)/`, and `/### Lunch\s*\n([\s\S]*?)(?=\n##|$)/` drift the moment the LLM phrases a meal entry slightly differently. The result is both false nags ("I already logged lunch, why is it asking again?") and silent skips ("it never reminded me about my supplements"). Cross-day counters in `AGENTS.md` have the same prose-drift problem.

This rewrite replaces every regex-based state read with a typed, tool-driven JSON state store. Markdown stays as freeform content for the LLM; JSON becomes the deterministic source of truth for scheduling decisions.

## Requirements

**Per-day state store**
- R1. Each day gets a `daily/YYYY-MM-DD.json` file holding per-slot report flags as nullable ISO timestamps (not booleans). Slots: `breakfast_reported`, `lunch_reported`, `dinner_reported`, `morning_supps_reported`, `evening_chemo_reported`, `sleep_reported`, `summary_sent`. Sleep is its own slot, decoupled from morning supplements.
- R2. The same JSON file holds running totals: `{ kcal, protein, carbs, fat }`. The scheduler derives "behind pace" nudges from these totals, never from parsing markdown.
- R3. All JSON state is Zod-validated on read and write. Invalid state on disk fails loud at startup rather than silently degrading scheduler behavior.

**Cross-day state store**
- R4. A single `memory.json` holds cross-day state: `streak.{kind}`, `missed_count`, `tapering_level` (derived from `missed_count`), `last_active_at`. `AGENTS.md` retains only persona/instructional prose — no counters, no streak lines.
- R5. `memory.json` is updated by code, not the LLM, for deterministic counters. The LLM has one escape-hatch tool (`override_streak`) for honest corrections ("I cheated yesterday, reset my streak").

**LLM tool surface**
- R6. The LLM mutates state exclusively through typed, Zod-validated tools. Final tool surface for state: `log_meal`, `mark_reported`, `unmark_reported`, `override_streak`. The existing `read_file` / `write_file` tools remain for markdown content.
- R7. `log_meal({slot, kcal, protein, carbs, fat})` updates running totals AND sets the corresponding `{slot}_reported` timestamp atomically. Slot `snack` updates totals without flipping a report flag.
- R8. `mark_reported({slot})` sets only the timestamp for non-meal slots (`morning_supps`, `evening_chemo`, `sleep`, `summary_sent`). `unmark_reported({slot})` clears any slot's timestamp for corrections.
- R9. Meal content (prose description of what was eaten) is still written by the LLM via `write_file` to the daily markdown. The LLM calls `log_meal` AND `write_file` for a single meal report; drift between the two is accepted as a known risk in exchange for keeping prose freeform.

**Scheduler behavior**
- R10. Every cron job reads only `daily/YYYY-MM-DD.json` and `memory.json` — no markdown parsing, no regex. The decision to fire or skip is a pure function of `(state, now) → decision`.
- R11. The scheduler builds a typed `TurnContext` — `{ kcal_so_far, kcal_target, pace_ratio, missed_slots_today, tapering_level }` — and passes it to the LLM turn alongside the systemNote. String-concatenated "behind pace" notes are replaced by structured context the persona can phrase in its own voice.
- R12. Day boundary is defined as a **logical day with a 04:00 Europe/Copenhagen cutoff**. A meal reported at 00:05 Friday writes to Thursday's file. One shared `logicalToday()` helper is the only allowed way to resolve "which file is today."

**Observability & verification**
- R13. Every scheduler tick appends a decision line to `daily/YYYY-MM-DD.decisions.jsonl`: `{ ts, reminderId, stateSnapshot, decision: 'fire'|'skip', reason }`. Answers "why did (or didn't) it nag me?" without guessing.
- R14. A dry-run CLI — `npm run naggr:dry-run -- --at "2026-04-17T13:00"` — loads a given day's state and prints what each cron job would decide at that moment, with structured context. Does not call the LLM or send any Telegram message.
- R15. Vitest harness seeds in-memory state, advances a virtual clock, and asserts which reminders fire. Every reminder in the scheduler has at least one "fires when unreported" and one "skips when reported" test.

**Migration**
- R16. Existing `daily/*.md` files and the `*.bak` siblings are deleted on cutover. No history preserved.
- R17. `AGENTS.md` operating-memory sections (`### Current Streak`, `### Response Behavior`) are removed on cutover. `ensureDailyLog` in `src/llm.ts` (the existing function with the disk-write side effect) creates both the markdown template AND the JSON state file side-by-side on day rollover. `blankDaily` stays a pure template-string function.
- R18. `skills/log-food/SKILL.md` and `skills/log-supplement/SKILL.md` are updated to prescribe calling `log_meal` + `write_file` (food) and `mark_reported` + `write_file` (supplements) — not the current regex-hostile checkbox/placeholder prose.

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────────┐
│                        LLM (Claude)                         │
│  tools: log_meal, mark_reported, unmark_reported,           │
│         override_streak, read_file, write_file              │
└─────┬─────────────────────────────────────┬─────────────────┘
      │ state writes (Zod-validated)        │ content writes
      ▼                                     ▼
┌──────────────────────┐          ┌──────────────────────────┐
│ daily/YYYY-MM-DD.json│          │ daily/YYYY-MM-DD.md      │
│   flags + totals     │          │   freeform prose         │
└─────────┬────────────┘          └──────────────────────────┘
          │                                  ▲
          │ state reads                      │ included in
          │ (no regex)                       │ system prompt
          ▼                                  │
┌─────────────────────────────────────────┐  │
│         Scheduler (5 cron jobs)         │──┘
│   pure (state, now) → decision          │
│   writes decisions.jsonl on every tick  │
└─────────────────────────────────────────┘

┌──────────────────────┐         bot inbound → last_active_at
│    memory.json       │◄─────── scheduler → missed_count, streak
│  streak, missed,     │         LLM override → streak
│  tapering, active    │
└──────────────────────┘
```

## Success Criteria

- Zero occurrences of `new RegExp(...)` or `/.../ .match(...)` against markdown files in the naggr codebase after cutover. Verified by grep.
- Scheduler decision tests (R15) cover all five reminders and pass in CI. Adding a new reminder without a test is caught by a simple assertion that `reminders.length === decisionTests.length`.
- A false-nag dogfood check: manually log lunch at 12:45, confirm the 13:00 cron's dry-run at 13:00:01 returns `skip`. A silent-skip dogfood check: leave breakfast unlogged, confirm the 09:00 cron's dry-run returns `fire`.
- Token budget per turn does not regress by more than ~15% after including JSON state alongside markdown in the system prompt.

## Scope Boundaries

- **Not doing** the event-log foundation (ideation #3). Flags are the chosen model; event sourcing is revisited only if audit/replay becomes a real need.
- **Not doing** the config-driven reminder registry (ideation #6). Five reminders in hand-written code is fine; register when a third new nag type appears.
- **Not doing** skip/snooze tools (ideation #5). Added only when Jakob actually says "I'm fasting today" and it creates friction.
- **Not doing** multi-user prefixes or a pluggable storage backend. Single user, single Hetzner server.
- **Not doing** a migration of existing `daily/*.md` content. Files are deleted per the "start fresh" decision.

## Key Decisions

- **Markdown + raw JSON both included in system prompt** — simplest additive change to `buildSystemPrompt`; LLM already handles both formats well; token cost acceptable.
- **Logical day with 04:00 boundary** — matches human intuition for late-night eating; one helper function vs. pushing judgment to the LLM.
- **Split `log_meal` (JSON) + `write_file` (markdown)** — preserves "don't parse what you can prompt"; accepts small drift risk in exchange for free markdown writing.
- **Code-driven cross-day counters + LLM escape hatch** — minimal tool surface; the LLM never does streak arithmetic; `override_streak` exists for honesty cases only.
- **JSONL decision log per day** — rotates naturally, easy to grep, no retention policy needed.
- **Ship as one PR, review the plan first** — cutover risk stays contained in one commit; the plan is the review checkpoint before any code changes.

## Dependencies / Assumptions

- `zod@^4.3.6` and `vitest@^4.1.4` are already in `package.json`. No new runtime dependencies required. Verified.
- Single-process deployment on Hetzner (one cron instance, one bot process). No distributed locking needed.
- The LLM running inside `callTurn` is a Claude model (currently `claude-sonnet-4-20250514`). Tool use and Zod-validatable JSON output are assumed reliable at that capability tier. Verified.
- The 30-min reminder follow-up currently lives in an in-memory `setTimeout` — a process restart loses in-flight follow-ups. **Accepted as an MVP limitation**; the persistent state-machine version (ideation #5) is deferred.

## Outstanding Questions

### Resolve Before Planning
- *(none — all blocking decisions resolved above)*

### Deferred to Planning
- [Affects R10, R17][Technical] `protocol.md`'s reminder schedule (07:30, 12:30, 18:00, 20:30, 22:30) has drifted from `src/scheduler.ts` (09:00, 13:00, 18:00, 21:00, 21:30). Plan should decide which is canonical and align. Likely: scheduler is the source of truth; update protocol.md.
- [Affects R4][Technical] Exact `streak.{kind}` keys — is there one aggregate streak, or separate streaks for meals vs supplements vs sleep? Today's `AGENTS.md` shows both a "Supplement compliance" streak and a "Food logging" streak. Plan should enumerate the kinds.
- [Affects R5][Technical] Mapping from `missed_count` to `tapering_level` — today's AGENTS.md uses thresholds "≥2 → soft", "≥3 → hard". Plan should codify these as a constant and decide the decay rule (does `missed_count` reset, and when?).
- [Affects R11][Technical] `kcal_target` currently hardcoded in scheduler strings (3500). Plan should decide whether to read it from `protocol.md` at boot (text parse) or mirror it into a small `config.ts` constant.
- [Affects R15][Technical] Vitest harness helpers' exact shape — `makeState(overrides)` + `runSchedulerAt(state, iso)` or something more granular. Planning can pin this after sketching the first two tests.
- [Affects R9][Technical] Atomicity hint in the `log_meal` tool result — should the tool response include a reminder string like "Now append the meal description to daily/YYYY-MM-DD.md under ### {slot}" to reduce the content-vs-flag drift risk? Plan should propose a mitigation.
- [Affects R3][Technical] Startup behavior when a `.json` file exists but fails Zod validation — crash loud, quarantine and regenerate, or auto-migrate? MVP likely: crash loud so drift surfaces immediately.

## Next Steps

-> `/ce:plan` for structured implementation planning
