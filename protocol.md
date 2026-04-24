# Protocol

## Identity & Goals
- Name: Jakob
- Core identity: "I'm someone who shows up for my health every day"
- Primary goals: Strength, shake compliance, supplement compliance, sleep

## Diet
- Approach: High-protein, anti-inflammatory
- Anchor points: two big protein shakes and the three supplement slots below. Meals happen around those; they are not tracked here.

## Shakes

Two large protein shakes per day. Treat them like supplements — non-negotiable.

- **Shake 1** — with morning supplements (around 08:30).
- **Shake 2** — by 14:30. A catch-up reminder fires at 19:30 if it still hasn't been logged.

## Supplements

**Morning (08:30, with breakfast and Shake 1):**
- Omega-3 (in breakfast shake)
- Vitamin D3 5000 IU x3
- Vitamin B12
- Vitamin C
- Magnesium glycinate
- Zinc

**Pre-dinner (17:30, ~30 min before dinner):**
- Probiotics

**Evening (21:00 / wind-down):**
- Magnesium glycinate
- Melatonin (30 min before bed)

## Sleep
- Target bedtime: 22:00
- Wind-down start: 21:00
- Routine: screens off → magnesium → reading → lights out

## Scheduled check-ins

The bot checks in five times per day (Europe/Copenhagen). Each check-in
reads this protocol and today's daily log and only asks about what's
still missing. If everything is already logged, the bot stays silent.

| Time  | What it asks about                                               |
|-------|------------------------------------------------------------------|
| 08:30 | Sleep, morning supplements, Shake 1                              |
| 14:30 | Shake 2                                                          |
| 17:30 | Pre-dinner supplements (probiotics)                              |
| 19:30 | Shake 2 — **only if still not logged**, otherwise silent         |
| 21:30 | Daily summary + evening supplements                              |

The user can also message the bot any time to log things early — an
item logged before its scheduled check-in just means the check-in skips
that question.

## Writing convention for today's daily log

When logging an entry to today's `daily/YYYY-MM-DD.md` file, use this shape:

`## HH:MM <Slot>: <contents>`

Examples:

```
## 08:25 Sleep: 7h, felt rested
## 08:30 Morning supplements: omega-3, D3 x3, B12, C, magnesium, zinc
## 08:35 Shake 1: chocolate whey + oats + banana
## 14:30 Shake 2: vanilla whey + peanut butter + milk
## 17:30 Pre-dinner supplements: probiotics
## 21:35 Evening supplements: magnesium, melatonin
## 21:35 Summary: Both shakes in, all sup slots hit, slept well. Strong day.
```

The shape is a suggestion — if prose doesn't fit (corrections, rambles,
surprise events, the user wanting to vent), break the convention and
write what fits. The goal is a log that both the user and the LLM can
skim, not a database row.

When deciding whether something is "already logged" for a check-in,
scan today's log for an entry matching the slot — `Sleep`,
`Morning supplements`, `Shake 1`, `Shake 2`, `Pre-dinner supplements`,
`Evening supplements`, `Summary`. Freeform prose counts if the meaning
is unambiguous.

The daily summary at 21:30 is compliance-focused: mention sleep, which
of the three supplement slots landed, whether both shakes got in (2/2,
1/2, 0/2), plus any freeform notes from the day.
