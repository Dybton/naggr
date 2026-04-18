---
title: "refactor: Simplify naggr to stateless LLM-driven check-ins"
type: refactor
status: active
date: 2026-04-18
deepened: 2026-04-18
origin: SPECS/spec1.md
---

# refactor: Simplify naggr to stateless LLM-driven check-ins

## Overview

Replace naggr's regex-driven, stateful scheduler with a stateless design where
the LLM reads `protocol.md` and today's `daily/YYYY-MM-DD.md` on every turn and
decides what's still missing. The app keeps its Telegram surface (text, voice
via OpenAI Whisper, images), its deployment (systemd on Hetzner, GitHub
Actions), and its `read_file` / `write_file` tool surface. Everything else —
streaks, tapering, 30-minute follow-ups, skills folder, vitest suite, the
second user, most of the ambient `.md` files cluttering the repo root — is
removed.

**This ships as one PR.** A multi-PR split was considered and rejected — for a
single developer on a single-user bot, strip-then-rewrite ceremony adds
temporal risk (deleting the test suite before the replacement ships) without
any reviewer to benefit from the checkpoint.

## Problem Frame

Naggr today fires reminders by running regex against freeform markdown the
LLM wrote minutes earlier. Patterns like `new RegExp(\`\\[x\\].*${name}\`, "i")`
and `/Calories:\s*~(\d+)/` drift the moment the LLM phrases a meal entry
slightly differently, producing false nags and silent skips. Operating memory
(streaks, missed-reminder counts, tapering level) lives as prose in
`AGENTS.md` and has the same drift problem. Layers of scaffolding — skills
folder, dual-user plumbing, tests that lock in the regex semantics, a 30-min
follow-up `setTimeout` — exist to prop up a system that doesn't need to be
this complicated.

`SPECS/spec1.md` defines the replacement: 4 scheduled check-ins per day; each
one reads protocol + today's log and asks about what's missing; voice and
images supported; no retries, no escalation, no taper logic; earlier days
ignored entirely.

This is **not** the direction captured in
[docs/brainstorms/2026-04-17-state-persistence-requirements.md](docs/brainstorms/2026-04-17-state-persistence-requirements.md) —
that brainstorm proposed a typed JSON state store as the source of truth for
scheduling decisions. `spec1.md` takes the opposite approach: "don't parse
what you can prompt." The LLM reads and writes markdown directly; the
scheduler is a dumb timer that hands work to the LLM.

### Identity shift (named explicitly)

The superseded brainstorm described **a reliable scheduler that uses an LLM
as a friendly mouthpiece**. This plan describes **an LLM companion that uses
cron as a heartbeat**. Different products. The bet: for a single-user
personal health bot, the LLM's judgment about what's missing — read fresh
from a markdown file each turn — is a better fit than a typed state store
and ground-truth counters. Reversing direction later is a one-week effort,
not a one-month effort, because the daily markdown files are still on disk.

## Requirements Trace

Derived from [SPECS/spec1.md](SPECS/spec1.md):

- **R1.** Four scheduled check-ins per day at 09:00, 13:00, 19:00, 21:30
  Europe/Copenhagen. (Note: 19:00 / 21:30, superseding current 18:00 / 21:00+21:30.)
- **R2.** Morning 09:00 asks: how I slept, morning supplements, breakfast.
- **R3.** Lunch 13:00 asks: lunch (calories + protein).
- **R4.** Dinner 19:00 asks: dinner (calories + protein).
- **R5.** Evening 21:30 asks: daily summary, evening supplements.
- **R6.** Each scheduled turn reads `protocol.md` and today's
  `daily/YYYY-MM-DD.md` and only asks about what's still missing. If
  everything's already logged, the scheduled turn **stays silent** (sends no
  Telegram message at all).
- **R7.** The user can message the bot any time to log things early; a later
  scheduled check-in seeing that log skips the question.
- **R8.** No user-facing reminder retries beyond the four scheduled times. No
  escalation, no taper logic. (This does *not* prohibit a one-shot Claude
  API retry on transient 5xx / network failure — see Key Technical
  Decisions.)
- **R9.** Voice messages supported (continue using OpenAI Whisper).
- **R10.** Images supported (continue sending to Claude vision).
- **R11.** No regex in the codebase. Zero occurrences of `new RegExp(...)`
  or bare regex literals run against markdown content.
- **R12.** `protocol.md` is free-form markdown, edited by the LLM via
  `write_file` when the user asks it to.
- **R13.** `daily/YYYY-MM-DD.md` is free-form markdown. The LLM reads and
  writes it directly. No schema, no parsing layer — but a **soft writing
  convention** lives in `protocol.md` so consecutive LLM turns produce
  compatible structure (see Key Technical Decisions).
- **R14.** Context within a day comes from two sources: today's daily
  markdown file (primary, survives restart) and a tiny in-process buffer of
  the last ~4 messages per chat (preserves mid-conversation reference
  resolution like "actually make it 500"). Earlier days are not read.
- **R15.** Single user (just Jakob). Drop dual-user plumbing.
- **R16.** Only `JAKOB_CHAT_ID` may interact with the bot. All Telegram
  handlers check `ctx.chat.id` before dispatching; messages from any other
  chat are silently ignored.

## Scope Boundaries

- Not introducing a typed JSON state store (explicitly rejected in favour of
  spec1 direction).
- Not building a skip/snooze tool. Not building persistent reminder state.
- Not preserving any history from existing `daily/*.md` or `daily/*.bak`
  files — deleted on cutover.
- Not adding multi-user support, per-user protocols, or pluggable storage.
- Not changing deployment (systemd + GitHub Actions on Hetzner stay as-is).
- Not adding new runtime dependencies beyond what's already in
  `package.json`.

### Deferred to Separate Tasks

- Rotation / hygiene of the Hetzner `DEPLOY_SSH_KEY` and its root-shell
  blast radius — pre-existing operational concern, not introduced here.

## Context & Research

### Relevant Code and Patterns

- [src/index.ts](src/index.ts) — boot loader; wires bot + scheduler. Reads
  both `JAKOB_CHAT_ID` and `LAERKE_CHAT_ID` today.
- [src/bot.ts](src/bot.ts) — grammy Telegram handler. Text, voice, and photo
  paths. Keeps a per-chat in-memory ring buffer of the last 10 message pairs.
- [src/llm.ts](src/llm.ts) — Claude SDK client. Builds system prompt from
  `SOUL.md` + current time + today's `daily/*.md` + `protocol.md` +
  `AGENTS.md` + hardcoded rules. Exposes `read_file` and `write_file` tools
  with a `.bak` safety backup. `ALLOWED_FILES` allowlist:
  `protocol.md`, `AGENTS.md`, `users.md`, `daily/YYYY-MM-DD.md`. Model:
  `claude-sonnet-4-20250514`.
- [src/scheduler.ts](src/scheduler.ts) — 5 node-cron jobs (09:00, 13:00,
  18:00, 21:00, 21:30). Regex-based meal / supplement / chemo checks. 30-min
  follow-up `setTimeout`. Reads "Missed reminders" from `AGENTS.md` for
  tapering tone.
- [src/voice.ts](src/voice.ts) — OpenAI Whisper (Danish) transcription.
  Keep unchanged.
- [src/storage/persona.ts](src/storage/persona.ts) — caches `SOUL.md` at
  boot. Keep unchanged.
- [SOUL.md](SOUL.md) — persona file. Today still references "WhatsApp" and
  describes Lærke as a second user. Must be rewritten by hand in this PR.
- Other root `.md` files: `HEARTBEAT.md`, `IDENTITY.md`, `TOOLS.md`,
  `USER.md`, `users.md` — ambient state / scratch files from earlier
  iterations. None are imported from `src/` (verify during implementation).
- [naggr.service](naggr.service) and
  [.github/workflows/deploy.yml](.github/workflows/deploy.yml) — systemd
  + GitHub Actions deploy. Keep unchanged.

### Regex occurrences to eliminate (R11)

All in `src/`:
- `src/scheduler.ts` — 6 occurrences (meal-section extraction,
  supplement-checkbox checks, calorie extraction, chemo checkbox,
  missed-reminders parsing). All removed when the scheduler is rewritten.
- `src/llm.ts` — 1 occurrence:
  `name.match(/^daily\/(\d{4}-\d{2}-\d{2})\.md$/)` validating the daily
  filename in the `read_file` / `write_file` tool call. Replaced with
  string-split + digit-length + real-date-roundtrip check.

### Institutional Learnings

- No prior entries in `docs/solutions/` (directory does not exist).
- Prior brainstorm
  ([docs/brainstorms/2026-04-17-state-persistence-requirements.md](docs/brainstorms/2026-04-17-state-persistence-requirements.md))
  proposed the *opposite* direction (typed JSON state store). Explicitly
  superseded here.

### External References

- Skipped. Local patterns are sufficient (node-cron, grammy, Anthropic SDK
  are all well-established in this codebase).

## Key Technical Decisions

- **LLM decides what's missing, not code.** Each scheduled turn hands the LLM
  a short systemNote ("It's 09:00. Morning check-in: sleep, morning
  supplements, breakfast. If everything is already logged in today's file,
  reply with exactly `<silent>` and nothing else.") plus the protocol and
  today's daily markdown. The LLM decides: ask about what's missing, or emit
  the silence sentinel.

- **Silence sentinel.** If the LLM decides nothing is missing, it returns the
  literal string `<silent>` and calls no tools. The scheduler handler
  `trim()`s the reply and skips `bot.api.sendMessage` when it equals
  `<silent>` or is empty. This implements R6's "stay silent" behavior
  without any code-side state check.

- **Tiny in-process message buffer, not a full ring buffer.** Today's
  per-chat ring buffer holds the last 10 message pairs. Replace with a
  bounded buffer of the last ~4 messages per chat. No persistence, cleared
  on restart, no TTL. This preserves mid-conversation reference resolution
  ("actually make it 500" referring to a prior photo/reply) while removing
  the bulk of the buffer. The daily markdown file is still the primary
  source of cross-restart continuity.

- **Soft writing convention lives in `protocol.md`, not in code.** The LLM
  is instructed (via protocol.md) to log entries as:
  `## HH:MM <Slot>: <contents>` — e.g.
  `## 12:50 Lunch: Chicken sandwich, ~550 kcal, 35g protein`. Zero parser,
  zero regex, zero enforcement. The LLM reads its own past entries and
  self-reinforces the shape. Escape hatch: it can break the convention when
  prose doesn't fit (corrections, rambles).

- **Minimal daily template.** `blankDaily()` returns `# YYYY-MM-DD\n\n`. No
  pre-populated sections, no checkboxes, no placeholders. The soft writing
  convention above gives the LLM a shape without code enforcing one.

- **Calendar day boundary, Europe/Copenhagen.** A message at 00:05 Friday
  writes to Friday's file.

- **Keep `read_file` + `write_file` as the only tools.** Allowlist shrinks
  to exactly `protocol.md` and `daily/YYYY-MM-DD.md` — `AGENTS.md` and
  `users.md` drop out.

- **Inbound chat gate in `bot.ts`.** Every Telegram handler (text, voice,
  photo) checks `ctx.chat?.id !== JAKOB_CHAT_ID` and silently returns
  before doing any work. Prevents any Telegram user who discovers the bot
  handle from getting a running LLM with `write_file` access to Jakob's
  health data.

- **`protocol.md` fallback on missing file.** `buildSystemPrompt` calls
  `existsSync` before reading `protocol.md`; if absent, substitutes a short
  string ("Protocol file not found. Ask the user what their daily protocol
  should be.") instead of crashing. Prevents fresh-host deploy loops.

- **One retry on transient Claude API failure for scheduled ticks only.**
  Spec1's "no retries" rule covers user-facing re-nagging, not API-call
  resilience. Scheduled ticks retry exactly once after 60 seconds on 5xx or
  network errors. User-initiated turns do not retry (the user sees the
  error and can resend). Bounded one retry; no chain.

- **Keep voice via OpenAI Whisper.** `src/voice.ts` stays as-is.

- **Upgrade model to `claude-sonnet-4-6`.** Current-generation Sonnet alias
  for new work on this account. Verify the literal identifier matches
  Anthropic's published model ID before merging — if their naming uses a
  dated form (`claude-sonnet-4-6-<date>`) the constant in `src/llm.ts` must
  match that exactly.

- **SOUL.md is rewritten in this PR.** Remove WhatsApp platform references
  and all Lærke / second-user prose. Treated as content, not code — edited
  by hand in the PR.

- **Delete the vitest suite.** Existing tests lock in regex-based decisions
  being removed; post-rewrite behavior is prompt-shaped and not unit-
  testable. Verification is manual dogfood.

- **Delete ambient `.md` clutter from repo root.** `AGENTS.md`, `users.md`,
  `HEARTBEAT.md`, `IDENTITY.md`, `TOOLS.md`, `USER.md` all go. If any turn
  out to contain prose worth keeping, fold into `SOUL.md` during the
  rewrite rather than keeping a separate file.

## Open Questions

### Resolved During Planning

- Operating memory (AGENTS.md, streaks, tapering) — delete entirely.
- Daily template — minimal (just a date header).
- Skills folder — delete entirely.
- Single vs dual user — single user + chatId inbound gate.
- Voice — keep OpenAI Whisper.
- Model — `claude-sonnet-4-6`.
- Tests — delete entirely.
- Day boundary — calendar day, Europe/Copenhagen.
- Cron times — 09:00 / 13:00 / 19:00 / 21:30.
- In-day context — daily markdown (primary) + tiny in-process buffer
  (mid-conversation only).
- PR count — one.
- Silent acknowledgment at scheduled ticks — stay silent (no Telegram
  message at all).
- Writing conventions — soft convention in `protocol.md`, not in code.
- Transient API failure in scheduled ticks — one retry after 60s.
- SOUL.md stale references — rewrite in this PR.
- Ambient `.md` files in repo root — delete all of AGENTS.md, users.md,
  HEARTBEAT.md, IDENTITY.md, TOOLS.md, USER.md; fold anything worth keeping
  into SOUL.md during its rewrite.

### Deferred to Implementation

- Exact wording of the four scheduled systemNotes. Drafted in Unit 3; tuned
  by hand after the first day of dogfood.
- Whether to keep the `.bak` backup on `write_file`. Proposing keep as-is
  for safety; revisit if it causes friction.
- Whether to verify `claude-sonnet-4-6` is the literal Anthropic model ID
  or whether the constant needs the dated form
  (`claude-sonnet-4-6-<YYYYMMDD>`). Check `@anthropic-ai/sdk`'s current
  model listing at implementation time.
- Size of the in-process message buffer (3? 4? 6?). Start at 4; adjust
  after dogfood.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for
> review, not implementation specification. The implementing agent should
> treat it as context, not code to reproduce.*

**Scheduled tick path (e.g., 09:00):**

```
at 09:00 Europe/Copenhagen:
  systemNote = "It's 09:00. Morning check-in — ask about sleep, morning
                supplements, and breakfast, but only about what isn't
                already in today's log. If everything is already logged,
                reply with exactly `<silent>` and call no tools."
  reply = callScheduledTurn(systemNote)   // with 1x retry on 5xx/net
  if reply.trim() && reply.trim() !== "<silent>":
    bot.api.sendMessage(JAKOB_CHAT_ID, reply)
```

**callTurn (pinned signature):**

```
callTurn(chatId, { text?, image?, systemNote? })  -> Promise<string>
```

- User-initiated turns pass `text` or `image` (from bot.ts handlers).
- Scheduled turns pass `systemNote` only. When no text is provided, the
  function synthesizes a minimal stub user message (`"."`) so the Anthropic
  API call is valid — documented explicitly, not handwaved.
- The function reads today's daily + protocol + SOUL from disk, builds the
  system prompt, runs the tool-call loop (max 5 rounds), and returns the
  final text reply.

**Inbound gate (bot.ts), applied to every handler:**

```
if (ctx.chat?.id !== JAKOB_CHAT_ID) return;
```

**Daily-file path validation (no regex):**

```
isValidDailyPath(name):
  if not name.startsWith("daily/") or not name.endsWith(".md"): reject
  stem = name between "daily/" and ".md"
  parts = stem.split("-")
  if parts.length !== 3 or part lengths !== [4,2,2]: reject
  if any part contains non-digits: reject
  if new Date(`${stem}T00:00:00Z`) round-trips to !== stem via
     toISOString().slice(0,10): reject
  accept
```

## Implementation Units

- [ ] **Unit 1: Bulk deletions and dead-weight cleanup**

**Goal:** Remove every file and code path that isn't part of the new
design, in one sweep. Leaves the app still booting (regex scheduler
unchanged at this point) but with a much smaller surface.

**Requirements:** R8, R11 (partial), R15.

**Dependencies:** None.

**Files:**
- Delete: `AGENTS.md`, `users.md`, `HEARTBEAT.md`, `IDENTITY.md`,
  `TOOLS.md`, `USER.md`, `skills/`, `tests/`.
- Modify: `src/llm.ts` — remove the AGENTS.md branch from
  `buildSystemPrompt`, remove `users.md` references, drop both from
  `ALLOWED_FILES`. Do **not** yet touch the daily-filename regex (Unit 4).
- Modify: `src/scheduler.ts` — delete `readAgentsContext` (or equivalent),
  the tapering-tone logic, the 30-minute `setTimeout` follow-up, and any
  fan-out to `laerkeChatId`. Keep the regex-based meal/supplement checks
  in place for now — they're removed wholesale in Unit 3.
- Modify: `src/index.ts` — drop `LAERKE_CHAT_ID` env read and remove the
  `laerkeChatId` parameter passed to `startScheduler`.
- Modify: `.env.example` — drop `LAERKE_CHAT_ID`.
- Modify: `package.json` — remove `test` and `test:watch` scripts; remove
  `vitest` from `devDependencies`.
- Modify: `package-lock.json` — regenerated by `npm install`.

**Approach:**
- One sweep. `rm` the files, strip the imports and references in `src/`,
  regenerate `package-lock.json`. The bot should still boot and answer
  text messages after this unit (with the old regex scheduler).

**Patterns to follow:**
- Existing `buildSystemPrompt` and `startScheduler` structure stays; this
  unit only deletes branches, doesn't restructure.

**Test scenarios:**
- Test expectation: none — pure deletion. Verified by `npm start` booting
  and the bot replying to a text message.

**Verification:**
- `grep -r --exclude-dir=node_modules AGENTS\\.md .` returns nothing.
- `grep -r --exclude-dir=node_modules LAERKE .` returns nothing.
- `grep -r --exclude-dir=node_modules vitest .` returns nothing.
- `ls` in repo root: no AGENTS.md / users.md / HEARTBEAT.md / IDENTITY.md /
  TOOLS.md / USER.md / skills / tests.
- `npm start` boots without errors.

---

- [ ] **Unit 2: Inbound chat gate + SOUL.md rewrite**

**Goal:** Close the "anyone who finds the bot gets an LLM with file-write
access" hole. Clean up SOUL.md so the system prompt no longer contradicts
itself (WhatsApp vs Telegram, single-user vs Lærke).

**Requirements:** R15, R16.

**Dependencies:** Unit 1 (dual-user plumbing already gone).

**Files:**
- Modify: `src/bot.ts` — at the top of every handler (text, voice, photo),
  early-return if `ctx.chat?.id !== JAKOB_CHAT_ID`. The check uses the
  same env var `JAKOB_CHAT_ID` already loaded at boot; parse to `Number`
  once at module load.
- Modify: `SOUL.md` — rewrite by hand. Drop the "lives in WhatsApp" line
  and associated platform-formatting rules, drop the Lærke section, keep
  the core persona prose (warm, texting-not-email, conservative macro
  estimation, etc.). Target length: at or below current.

**Approach:**
- Gate is 2 lines at the top of each handler. Defensive: if
  `JAKOB_CHAT_ID` is unset or NaN, refuse to start the bot (fail loud at
  boot rather than accepting messages from everyone).
- SOUL.md rewrite is a content edit — not code. Done in the same PR so
  the system prompt is coherent with the new design on first boot.

**Patterns to follow:**
- Existing handler structure in `src/bot.ts` — just prepend the gate.

**Test scenarios:**
- Test expectation: none (gate) — manual verification via Telegram only,
  since a "send from a different account to confirm ignore" test needs a
  second account. If you have one, send a message and confirm the bot
  stays silent.
- SOUL.md: no test; visual review of the file and of one live bot turn
  after the rewrite to confirm tone is intact.

**Verification:**
- Bot boots only when `JAKOB_CHAT_ID` is set to a valid integer.
- `grep -i "whatsapp\|lærke\|laerke" SOUL.md` returns nothing.
- One live text turn after rewrite produces a reply consistent with the
  new persona prose.

---

- [ ] **Unit 3: Rewrite the scheduler as four stateless LLM-driven jobs**

**Goal:** Replace the regex-driven meal / supplement / chemo checks with
four dumb cron jobs at 09:00 / 13:00 / 19:00 / 21:30 Europe/Copenhagen,
each handing the LLM a short systemNote. Implement the silence sentinel
and the one-shot retry on transient API failure.

**Requirements:** R1, R2, R3, R4, R5, R6, R8, R11.

**Dependencies:** Unit 1, 2.

**Files:**
- Modify: `src/scheduler.ts` — full rewrite.

**Approach:**
- Four `cron.schedule(cron, handler, { timezone: "Europe/Copenhagen" })`
  registrations. One shared `callScheduledTurn(systemNote)` helper that
  builds a closure over `bot` and `JAKOB_CHAT_ID`, calls `callTurn`,
  trims the reply, and either sends to Telegram or stays silent based on
  the sentinel.
- Retry policy: if `callTurn` throws a 5xx or network error (detectable
  via the Anthropic SDK's thrown error shape), wait 60s and retry exactly
  once. Any further failure is logged and dropped. User-initiated turns
  (bot.ts path) do not retry.
- No file reads, no regex, no state checks in scheduler code.
- SystemNote drafts:
  - 09:00: "Morning check-in. Ask about sleep, morning supplements, and
    breakfast — only about what isn't already in today's log. If
    everything is already logged, reply with exactly `<silent>` and call
    no tools."
  - 13:00: "Lunch check-in. Ask about lunch (calories + protein) unless
    already logged. Silence sentinel as above."
  - 19:00: "Dinner check-in. Ask about dinner (calories + protein) unless
    already logged. Silence sentinel as above."
  - 21:30: "Evening check-in. Write a short daily summary into today's
    log via `write_file` (using the `## HH:MM <Slot>: <contents>`
    convention — slot for the summary is `Summary`), then ask about
    evening supplements unless already logged. Silence sentinel if both
    the summary is already present AND evening supplements are already
    logged."

**Execution note:** Start by sketching the shared `callScheduledTurn`
helper, then register the four cron lines against it. Don't re-implement
cron glue four times.

**Technical design:** *(directional)*

```
const schedule = [
  { cron: "0 9 * * *",  note: "Morning check-in …" },
  { cron: "0 13 * * *", note: "Lunch check-in …"   },
  { cron: "0 19 * * *", note: "Dinner check-in …"  },
  { cron: "30 21 * * *", note: "Evening check-in …" },
];
for (const s of schedule) {
  cron.schedule(s.cron, () => callScheduledTurn(s.note),
                { timezone: "Europe/Copenhagen" });
}

const callScheduledTurn = async (note: string) => {
  const reply = await callTurnWithRetry({ systemNote: note });
  const trimmed = reply.trim();
  if (!trimmed || trimmed === "<silent>") return;
  await bot.api.sendMessage(JAKOB_CHAT_ID, trimmed);
};
```

**Patterns to follow:**
- node-cron registration pattern already present in current
  `src/scheduler.ts`.
- `callTurn` signature is pinned in Unit 4 — this unit depends on that
  signature landing first or in the same commit.

**Test scenarios:**
- Test expectation: none automated — behavior is prompt-shaped. Dogfood
  plan:
  - Log breakfast via bot at 08:50; confirm the 09:00 tick is silent (no
    Telegram message arrives).
  - Leave lunch unlogged; confirm the 13:00 tick asks about lunch.
  - Force an API failure (temporarily revoke the API key) at 21:25 and
    restore it at 21:30:30; confirm the evening tick's retry fires at
    ~22:30 and succeeds (or logs cleanly if still failing).

**Verification:**
- `grep -nE "RegExp|\\.match\\(" src/scheduler.ts` returns nothing.
- `grep -n "setTimeout" src/scheduler.ts` returns nothing (no follow-ups).
- Manual dogfood per above.

---

- [ ] **Unit 4: Simplify `llm.ts` — system prompt, callTurn signature,
      model bump, protocol.md fallback, regex-free path validation**

**Goal:** Make `callTurn` coherent with both the bot and scheduler call
paths. Trim the system prompt. Add the protocol.md fallback. Replace the
last regex in the codebase.

**Requirements:** R6, R11, R13, R14.

**Dependencies:** Unit 1 (allowlist already shrunk for AGENTS.md / users.md).

**Files:**
- Modify: `src/llm.ts`.

**Approach:**
- **Signature pin:**
  `callTurn(chatId: number, input: { text?: string; image?: ImageInput;
  systemNote?: string; history?: ChatMessage[] }) => Promise<string>`.
  `history` is the tiny in-process buffer passed from bot.ts (Unit 5);
  the scheduler omits it. When only `systemNote` is present and no
  history, synthesize a stub user message (`"."`) so the Anthropic API
  accepts the request — document this inline with a one-line comment
  explaining why.
- **System prompt trim:** `buildSystemPrompt` now concatenates SOUL +
  current time + today's daily + protocol + `systemNote ?? ""` + a
  minimal rules block. Drop AGENTS.md, users.md, and the hardcoded rules
  that described the old structured sections.
- **Rules block content (post-trim):** Telegram formatting, conservative
  macro estimation, "when logging a meal / supplement / sleep / summary,
  append to today's daily file via `write_file` using the shape defined
  in protocol.md." Everything else goes.
- **protocol.md fallback:** before `readFileSync(protocolPath)`, check
  `existsSync`. If absent, substitute:
  `"Protocol file not found. Ask the user what their daily protocol
  should be."`
- **Daily filename validation:** replace the regex with the
  `isValidDailyPath` algorithm from the High-Level Technical Design
  section. `isNaN(new Date(...))` + round-trip check.
- **Model bump:** constant to `claude-sonnet-4-6`. Add a one-line
  comment pointing at Anthropic's current model ID doc so future
  updates are obvious.
- **Allowlist:** `ALLOWED_FILES` = `["protocol.md", /* daily files
  validated via isValidDailyPath */]`. Rejections are silent (return an
  error to the tool-call loop, don't throw).

**Patterns to follow:**
- Existing `buildSystemPrompt` / `callTurn` / tool-call-loop structure
  stays. This unit rewrites their bodies, not the module shape.

**Test scenarios:**
- Test expectation: none automated. Verified by booting and exchanging
  one text turn + one image turn + one voice turn.

**Verification:**
- `grep -nE "RegExp|/[^/]*/" src/llm.ts` returns nothing (no regex, no
  stray literals). Allow division operators to fail this grep if
  needed; verify manually that no regex literals remain.
- `grep -n "claude-sonnet-4-20250514" src/` returns nothing.
- `grep -n "AGENTS\\.md\\|users\\.md" src/` returns nothing.
- Boot on a host with no `protocol.md` and confirm the bot starts and
  answers with the fallback prompt, not a crash.

---

- [ ] **Unit 5: Shrink the in-memory buffer in `bot.ts`**

**Goal:** Replace the 10-pair ring buffer with a bounded 4-message
buffer per chat. Preserve mid-conversation reference resolution
("actually make it 500") without the weight of longer history.

**Requirements:** R14.

**Dependencies:** Unit 4 (callTurn accepts an optional `history`).

**Files:**
- Modify: `src/bot.ts`.

**Approach:**
- Keep `Map<number, ChatMessage[]>` keyed on chatId.
- Cap at 4 messages total (user + bot combined), FIFO eviction.
- After each handler's `callTurn`, push the user message and the bot
  reply, then trim.
- No TTL, no persistence. Cleared on process restart by design — the
  daily markdown carries longer-term continuity.

**Patterns to follow:**
- Existing buffer shape in `src/bot.ts` — trim the size, don't
  restructure.

**Test scenarios:**
- Test expectation: none automated. Verify via a multi-turn exchange:
  send a photo of food → bot estimates calories → reply "actually make
  it 500" → confirm the bot's next reply references the same meal.

**Verification:**
- Manual dogfood per above.
- `grep -n "Map\\|history" src/bot.ts` shows the buffer still present
  but trimmed.

---

- [ ] **Unit 6: Minimal daily template**

**Goal:** `blankDaily()` returns `# YYYY-MM-DD\n\n`. Nothing else.

**Requirements:** R13.

**Dependencies:** Unit 4 (system prompt no longer references the old
template's sections).

**Files:**
- Modify: `src/llm.ts` — rewrite `blankDaily` to a single template
  literal.

**Approach:**
- `const blankDaily = (date: string): string => \`# ${date}\\n\\n\`;`
- `ensureDailyLog` stays the same otherwise — still creates the file
  lazily on first read if missing.

**Patterns to follow:** n/a.

**Test scenarios:**
- Test expectation: none. Verified by deleting today's daily file and
  triggering one bot turn — confirm the new file is exactly
  `# YYYY-MM-DD\n\n`.

**Verification:**
- Described above.

---

- [ ] **Unit 7: Rewrite `protocol.md` with new schedule + soft writing
      convention**

**Goal:** Realign `protocol.md` to the four check-ins at 09:00 / 13:00 /
19:00 / 21:30 and include the soft writing convention that anchors the
LLM's freeform output. Remove old checkbox / (not logged) / regex-era
prose.

**Requirements:** R6, R12, R13.

**Dependencies:** Units 1–6 landed.

**Files:**
- Modify: `protocol.md` (repo root).

**Approach:**
- Rewrite by hand. Sections to include:
  - The four check-in times and what each asks about.
  - The current supplement list + dosages + timing.
  - Meal macro targets.
  - The **writing convention** block:
    > When logging entries to today's daily file, use this shape:
    > `## HH:MM <Slot>: <contents>`. Examples:
    > `## 08:15 Breakfast: Oats with yogurt, ~350 kcal, 18g protein`
    > `## 12:50 Lunch: Chicken sandwich, ~550 kcal, 35g protein`
    > `## 09:05 Sleep: 7h, felt rested`
    > `## 21:30 Summary: <1–2 sentence recap of the day>`
  - A note that freeform deviation is fine when the shape doesn't fit
    (corrections, rambles, surprise events).
- Keep it short. Protocol is LLM input, not a user manual.

**Patterns to follow:**
- Existing `protocol.md` section structure (short headings, bullet
  lists).

**Test scenarios:**
- Test expectation: none — content file.

**Verification:**
- Reminder times in `protocol.md` are exactly 09:00, 13:00, 19:00,
  21:30.
- No prose references streaks, missed-reminder counts, `[x]` / `[ ]`
  checkbox conventions, or Lærke.
- The writing convention block is present with at least 3 examples.

---

## System-Wide Impact

- **Interaction graph:** Boot path shrinks — `src/index.ts` loses
  `LAERKE_CHAT_ID` wiring; scheduler registration stays. Telegram message
  path gains an inbound chatId gate, loses the large ring buffer (replaced
  by a tiny one). LLM tool-call path loses the regex filename validator
  and the AGENTS.md / users.md allowlist entries.
- **Error propagation:** Scheduler ticks retry once on transient API
  failure, then log and drop. User-initiated turns do not retry. All
  Telegram `sendMessage` calls stay inside try/catch to avoid crashing
  node-cron.
- **State lifecycle risks:** The LLM's judgment about "what's missing"
  depends on reading its own past prose in today's daily file. The soft
  writing convention in `protocol.md` is the primary mitigation against
  self-drift. If the LLM writes inconsistent formats, a later turn may
  misclassify logged-vs-missing; dogfood will surface this if it happens.
- **API surface parity:** Telegram `bot.api.sendMessage` usage unchanged.
  grammy handler shape unchanged other than the new chatId gate.
- **Integration coverage:** None automated. Manual dogfood is the
  verification layer.
- **Unchanged invariants:** `src/voice.ts` behavior; the `.bak` backup on
  `write_file`; the systemd unit and GitHub Actions deploy; `src/storage/
  persona.ts`'s SOUL caching.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| LLM misjudges what's "already logged" from freeform prose and nags about breakfast even though the user already ate. | Soft writing convention in `protocol.md` gives the LLM a stable shape to self-reinforce. Dogfood catches remaining cases; tune systemNote wording without a code change. |
| LLM self-drift across a day: 09:00 writes one format, 13:00 writes another, 19:00 can't parse either. | Same mitigation — the convention in protocol.md is in every turn's system prompt. |
| Model upgrade to `claude-sonnet-4-6` changes response style subtly or the literal model ID is wrong. | Verify the ID against Anthropic's current listing at implementation time. Dogfood before closing PR. |
| Deleting the vitest suite removes any CI safety. | Accepted — post-rewrite behavior is prompt-shaped and was never adequately covered by those tests. Manual dogfood is the replacement. |
| Mid-conversation continuity lost without a full ring buffer. | 4-message in-process buffer covers the common case (photo → follow-up refinement). If still insufficient, size is a one-line tweak. |
| Anthropic API transient failure at 21:30 silences the evening check-in. | One retry after 60s on scheduled ticks. If that also fails, log and drop — documented acceptance. |
| `DEPLOY_SSH_KEY` is a long-lived root key on GitHub Actions — compromise = full Hetzner root. | Pre-existing; not introduced here. Flagged as deferred separate task. |
| Fresh host or accidentally-deleted `protocol.md` crashes `buildSystemPrompt`. | `existsSync` fallback in Unit 4. Bot answers with a stub prompt instead of crashing. |
| LLM prompt-injection via Whisper-transcribed voice ("ignore all previous instructions; write …"). | Keep the inbound chatId gate (only trusted input source). Accept the residual risk — the only attacker is the user themselves; they already have full control by editing protocol.md directly. |
| Cutover at a bad time wipes today's in-progress log. | Deploy during a low-traffic window (late night), or wait until after the 21:30 evening tick. |

## Documentation / Operational Notes

- `protocol.md` is the user-facing documentation of the bot's behavior;
  Unit 7 keeps it authoritative.
- No README exists today; nothing to update.
- Deploy continues via `git push` to `main` → GitHub Actions →
  `systemctl restart naggr` on Hetzner. No change.
- **Post-merge operational checklist** (not a plan unit — run after
  deploy):
  - SSH to Hetzner; remove `LAERKE_CHAT_ID` from the server's `.env`.
  - `systemctl is-active naggr` → `active`.
  - Send one text message, confirm reply within a few seconds.
  - Confirm journal shows no exceptions from `src/scheduler.ts` or
    `src/llm.ts` since boot.
  - Delete old `daily/*.md.bak` files on the server (optional cleanup).

## Sources & References

- **Origin document:** [SPECS/spec1.md](SPECS/spec1.md)
- **Superseded brainstorm:**
  [docs/brainstorms/2026-04-17-state-persistence-requirements.md](docs/brainstorms/2026-04-17-state-persistence-requirements.md)
- **Current scheduler (to be rewritten):**
  [src/scheduler.ts](src/scheduler.ts)
- **Current LLM integration (to be simplified):**
  [src/llm.ts](src/llm.ts)
- **Current bot handlers:** [src/bot.ts](src/bot.ts)
- **Boot loader:** [src/index.ts](src/index.ts)
- **Deploy:** [naggr.service](naggr.service),
  [.github/workflows/deploy.yml](.github/workflows/deploy.yml)
