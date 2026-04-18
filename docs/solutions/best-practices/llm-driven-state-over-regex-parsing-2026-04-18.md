---
title: "Replace regex-driven state management with LLM reads of freeform markdown"
module: scheduler / conversation-handler
date: 2026-04-18
category: best-practices
problem_type: best_practice
component: assistant
severity: medium
applies_when:
  - A bot or agent reads and writes structured data inside freeform user notes or logs
  - State already lives in human-readable files the LLM parses naturally
  - Regex or parser logic is fragile against small format changes
  - The audience is a single user, or each user has their own isolated state
  - Scheduled prompts need conditional silence (skip the send when nothing's missing)
related_components:
  - background_job
  - tooling
tags:
  - llm-driven
  - stateless
  - markdown-state
  - dont-parse-what-you-prompt
  - silence-sentinel
  - cron
  - telegram-bot
  - per-chat-mutex
---

# Replace regex-driven state management with LLM reads of freeform markdown

## Context

You have a bot that pings a user throughout the day — "did you take your
supplements?", "log your lunch" — and updates a markdown diary. The
straightforward implementation is also the brittle one: read the diary,
run regex against it, fire the reminder if the pattern doesn't match.

That works until the format drifts. You add a new supplement. You write
`✓ magnesium` instead of `[x] magnesium`. You log lunch under a
different heading. Now the regex silently fails, you get a reminder you
shouldn't, and the bug is invisible because the diary still looks fine
to a human. Every format change means a code change. Every code change
needs tests. Every test locks in the exact prose shape, making it even
harder to change the format later.

The naggr project hit this ceiling. Its before-state had 5 cron jobs,
each running regex chains against the daily markdown to decide whether
to nag. Operating state (streaks, tapering levels, missed-reminder
counts) lived as prose in `AGENTS.md` and was parsed with more regex.
A vitest suite locked in those semantics. Changing how you wanted to
log lunch meant touching the diary format, the regex, the tests, the
skills files, and sometimes the `AGENTS.md` parser.

The trade the new design makes is honest: you swap a deterministic but
brittle system for a flexible but non-deterministic one. The scheduler
no longer knows what "logged" means. The LLM does. If the LLM misreads
a diary entry, it might skip a reminder it should send, or send one it
shouldn't. That slippage is the real cost. The benefit is that your
diary format can evolve freely, new check-in types cost nothing to add,
and the code surface shrinks from hundreds of lines of parsing logic to
four stateless cron jobs.

This trade was acceptable here because the stakes are low (a missed
supplement reminder), the user is also the developer, and prompt tuning
is faster than regex debugging. It would not be acceptable in a billing
system, a multi-tenant app, or anywhere an adversary controls the input.

## Guidance

**Core pattern:** let the LLM read and decide. Give it the diary on
every turn. Write what you want it to check in a short `systemNote`
string. If everything is already logged, have it return a sentinel
string instead of a message. Use deterministic code only for what the
LLM genuinely cannot do — scheduling, file I/O, sending messages,
serialisation, access control.

### Sub-techniques

**1. Stateless scheduled prompts with a `systemNote`**

Each cron tick constructs a turn with a short instruction appended to
the system prompt. The LLM gets the full diary and decides on its own
whether anything is missing.

```ts
const systemNote =
  "Morning check-in. Ask about sleep, morning supplements, and breakfast " +
  "unless already logged. If everything is already logged, reply with " +
  "exactly <silent> and call no tools.";

const { reply } = await callTurn(chatId, { systemNote });
if (!reply.startsWith("<silent>")) {
  await bot.api.sendMessage(chatId, reply);
}
```

No regex. No state. The LLM re-reads the diary fresh on every tick.

**2. Silence sentinel (`<silent>`)**

Instead of a separate "should I fire?" tool call, the LLM returns a
distinctive string when it decides nothing needs saying. The scheduler
checks with `startsWith` — not strict equality — so harmless trailing
prose from the LLM doesn't break the check.

```ts
const SILENT = "<silent>";

if (trimmed.startsWith(SILENT)) return; // skip sendMessage
```

The angle-bracket syntax is deliberately ugly so the LLM won't produce
it by accident in normal prose, and so a human reading logs immediately
knows what it means.

**3. Per-chat mutex (`withChatLock`)**

If a voice message arrives at 08:59:59 and the 09:00 cron fires one
second later, both calls read the same stale diary, both write their
updates, and one clobbers the other. A per-chat serialisation queue
prevents that. Every `callTurn` for the same chatId waits for the
previous one to finish before running.

```ts
const chatQueues = new Map<number, Promise<unknown>>();

const withChatLock = <T>(chatId: number, fn: () => Promise<T>): Promise<T> => {
  const previous = chatQueues.get(chatId) ?? Promise.resolve();
  // Absorb prior errors so one failed turn doesn't poison the chain.
  const next = previous.catch(() => undefined).then(fn);
  chatQueues.set(chatId, next.catch(() => undefined));
  return next;
};

export const callTurn = (chatId: number, input: TurnInput) =>
  withChatLock(chatId, () => runTurn(input));
```

No locks, no semaphores — just a chain of promises. The cron tick and
the message handler queue behind each other. Whichever arrives first
completes fully — diary read, LLM call, diary write — before the
second starts. No write ever sees a stale file.

**4. Soft writing convention in `protocol.md`**

Tell the LLM how to format diary entries in the prompt, not in code.
The LLM reads its own past entries and naturally reproduces the shape.

```
Log entries as: ## HH:MM <Slot>: <contents>
Examples:
  ## 08:15 Breakfast: Oats with yogurt, ~350 kcal, 18g protein
  ## 09:05 Sleep: 7h, felt rested
  ## 12:50 Lunch: Chicken sandwich, ~550 kcal, 35g protein
```

This is an anchor, not enforcement. If the LLM drifts slightly, it's a
prompt fix, not a code change. The convention lives in `protocol.md`,
which is in every system prompt.

**5. Non-regex path validator**

The one place where determinism is genuinely required — constructing
the file path for today's diary — uses plain string operations. Even
here, it's tempting to reach for a regex; don't.

```ts
const MIN_YEAR = 2020;

const isDigits = (s: string): boolean => {
  for (const ch of s) {
    if (ch < "0" || ch > "9") return false;
  }
  return true;
};

export const parseDailyDate = (name: string): string | null => {
  if (!name.startsWith("daily/") || !name.endsWith(".md")) return null;

  const stem = name.slice("daily/".length, name.length - ".md".length);
  const parts = stem.split("-");
  if (parts.length !== 3) return null;

  const [y, m, d] = parts;
  if (y.length !== 4 || m.length !== 2 || d.length !== 2) return null;
  if (!isDigits(y) || !isDigits(m) || !isDigits(d)) return null;

  if (Number(y) < MIN_YEAR) return null;

  // Round-trip through Date — catches `2026-02-30` (which Date silently
  // normalises to March 2) and similar invalid calendar dates.
  const asDate = new Date(`${stem}T00:00:00Z`);
  if (isNaN(asDate.getTime())) return null;
  if (asDate.toISOString().slice(0, 10) !== stem) return null;

  return stem;
};
```

Covered by a 21-case smoke script (`scripts/verify-parse.ts`) that
exercises path traversal attempts, single-digit month/day, `Date.parse`
landmines, and the year floor.

**6. Startup fallbacks for missing config files**

Missing config files shouldn't crash boot. `SOUL.md` (persona) and
`protocol.md` (behaviour spec) both get `existsSync` fallbacks so a
fresh-clone deploy stays running while the operator copies files over.

```ts
export const loadSoul = (): string => {
  if (cachedSoul !== null) return cachedSoul;
  if (!existsSync(SOUL_PATH)) {
    console.warn(`[persona] SOUL.md not found; using fallback`);
    cachedSoul = FALLBACK_SOUL;
    return cachedSoul;
  }
  cachedSoul = readFileSync(SOUL_PATH, "utf-8");
  return cachedSoul;
};
```

**7. Inbound chatId gate**

Every Telegram handler checks the sender before doing anything else.
The LLM has `write_file` access to the protocol and diary; only one
allowlisted chatId should be able to reach it.

```ts
const isAllowed = (ctx: Context): boolean => ctx.chat?.id === allowedChatId;

bot.on("message:text", async (ctx) => {
  if (!isAllowed(ctx)) return;
  await handleText(ctx, ctx.message.text);
});
```

## Why This Matters

**Smaller code surface.** The before-state had 5 cron jobs wired to
regex chains, an `AGENTS.md` parser, a skills folder of prescriptive
prose files, a 30-minute follow-up `setTimeout`, dual-user fan-out,
and an in-memory message ring buffer. All of it load-bearing. The
after-state is 4 stateless cron jobs and one `callTurn` function.
Less code means fewer places for bugs to hide.

**Fewer drift bugs.** Regex breaks when format changes. A `systemNote`
doesn't care whether you wrote `[x] magnesium` or `took magnesium` or
`✓ mag`. The LLM understands them all. The diary format can evolve
without touching code.

**Prompt tuning is faster than code tuning.** Adding a new check-in
type before meant: new regex, new test, possibly a new SKILL.md. After:
one new `systemNote` string plus a line in `protocol.md`. Under two
minutes.

**Alignment with what each system is good at.** The LLM is good at
reading natural language and making judgement calls. Regex is good at
matching exact patterns. Forcing an LLM's output through a regex parser
uses both at their worst. Keeping the LLM in charge of interpretation
and deterministic code in charge of I/O uses both at their best.

**Compounds over time.** Each new prompt-side improvement (better
instructions, clearer examples, richer context) makes every check-in
smarter. Each new regex would have made the system more fragile.

**Honest trade-offs.** The LLM makes judgement calls, and judgement is
non-deterministic. On a bad response, it might skip a reminder it
should send (false skip) or send one it shouldn't (false nag). The
pattern requires a high-capability model reading reasonable context
windows. If the diary grows very large, token costs grow with it. And
if the prompt is vague, the LLM's interpretation will be too.

## When to Apply

Apply this pattern when:

- **The user is also the developer**, or each user has isolated state.
  The LLM sees the full diary. In a multi-tenant app, one user's diary
  could leak into another's context.
- **The LLM is already in the loop** for some part of the feature.
  Adding "read and decide" is almost free.
- **The format is freeform prose** that would require complex regex or
  a schema to parse. If you find yourself writing
  `/### Lunch\s*\n([\s\S]*?)(?=\n##|$)/`, stop and ask whether the LLM
  could just read it.
- **Reliability slack exists.** A missed supplement reminder is
  annoying. A missed payment reminder is not. Know your tolerance
  before you remove the deterministic guard.
- **The input is trusted.** You are writing the diary. The LLM reads
  it and decides. If an adversary could write the diary, they could
  manipulate the LLM's decisions — prompt injection is a real risk
  here.

Do NOT apply when:

- **Multi-tenant shared context.** If multiple users' data lives in
  the same prompt, the LLM will mix them up.
- **Hard-realtime or sub-millisecond decisions.** An LLM API call
  takes hundreds of milliseconds and can fail.
- **Adversarial inputs.** If untrusted users can write content the
  LLM reads to make decisions, assume those decisions can be
  manipulated.
- **Audit or compliance requirements.** "The LLM decided" is not an
  audit trail. Deterministic logic with explicit state machines is
  required wherever you need to explain exactly why a decision was
  made.
- **The format is already structured.** If the data is already JSON or
  a database row, parse it. The pattern is for cases where the
  information only exists as human-written prose.

## Examples

### Before vs. after: scheduler check

**Before** — the cron job reads the diary and runs regex to decide
whether to nag about lunch:

```ts
// Inside the 13:00 cron handler
const diary = readFileSync(todayPath, "utf8");
const lunchLogged = /### Lunch\s*\n([\s\S]*?)(?=\n##|$)/.test(diary);
const caloriesLogged = /Calories:\s*~(\d+)/.test(diary);
if (!lunchLogged || !caloriesLogged) {
  await bot.api.sendMessage(chatId,
    "Don't forget to log your lunch and calories!");
}
```

Any format drift — a different heading, a missing newline, calories
written as `500 kcal` instead of `~500` — silently breaks this and the
user gets nags forever or never.

**After** — the cron job hands the decision to the LLM:

```ts
// Inside the 13:00 cron handler
const systemNote =
  "Midday check-in. Ask about lunch unless already logged. " +
  "If everything is already logged, reply with exactly <silent>.";

const { reply } = await callTurn(chatId, { systemNote });
if (!reply.trim().startsWith("<silent>")) {
  await bot.api.sendMessage(chatId, reply);
}
```

The LLM reads the diary inside `callTurn`. It understands "had a
sandwich" and "lunch: 600 kcal" equally well. Format changes cost
nothing.

### Silence sentinel: systemNote + scheduler check

The `systemNote` tells the LLM exactly what string to return when it
decides to stay quiet:

```
Evening check-in. Ask about dinner and evening supplements unless
already logged. If everything is already logged, reply with exactly
<silent> and call no tools.
```

The scheduler checks with `startsWith`, not strict equality:

```ts
const isSilent = !trimmed || trimmed.startsWith(SILENT);
if (isSilent) return;
await bot.api.sendMessage(chatId, trimmed);
```

`startsWith` is intentional. The LLM occasionally appends a newline or
a short gloss after `<silent>`. Strict equality would break on those;
`startsWith` is tolerant without being loose enough to cause false
silences on unrelated messages.

### Per-chat mutex

A voice message and a cron tick arrive within one second of each
other. Without serialisation, both read the diary at the same moment,
both call the LLM, and the second `write_file` clobbers the first's
logged entry.

```ts
// Cron tick:
cron.schedule("0 9 * * *", () => {
  runCheckIn(bot, chatId, morningNote).catch(err =>
    console.error("[scheduler] MORNING handler threw:", err));
}, { timezone: "Europe/Copenhagen" });

// Incoming voice message:
bot.on("message:voice", async (ctx) => {
  if (!isAllowed(ctx)) return;
  const transcript = await transcribeVoice(ctx);
  await handleText(ctx, transcript); // eventually calls callTurn
});
```

Both paths call `callTurn(chatId, …)`. Inside `callTurn`, the
`withChatLock` wrapper queues them for the same chatId:

```ts
export const callTurn = (chatId: number, input: TurnInput) =>
  withChatLock(chatId, () => runTurn(input));
```

Cron tick and voice message queue behind each other. Whichever arrives
first completes fully — diary read, LLM call, diary write — before
the second starts. No write ever sees a stale file.

## Related

- Brainstorm for the opposite direction (typed JSON state store) that
  was **rejected** in favour of this pattern:
  [`docs/brainstorms/2026-04-17-state-persistence-requirements.md`](../../brainstorms/2026-04-17-state-persistence-requirements.md)
- Ideation that surfaced the "don't parse what you can prompt"
  principle as a constraint:
  [`docs/ideation/2026-04-17-state-persistence-ideation.md`](../../ideation/2026-04-17-state-persistence-ideation.md)
- The plan this learning closes out:
  [`docs/plans/2026-04-18-001-refactor-naggr-simplification-plan.md`](../../plans/2026-04-18-001-refactor-naggr-simplification-plan.md)
- Jakob's coding preferences (arrow functions, no `any`, no `.reduce()`,
  **no regex**, readability as top priority): `~/.claude/CLAUDE.md`
