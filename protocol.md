# Protocol

## Identity & Goals
- Name: Jakob
- Core identity: "I'm someone who shows up for my health every day"
- Primary goals: Strength, nutrition, sleep, supplement compliance

## Diet
- Daily target: ~3500 kcal, ~180g protein
- Approach: High-protein, anti-inflammatory
- Meals: 3 main + 1–2 snacks

## Supplements

**Morning (with breakfast):**
- Omega-3 (in breakfast shake)
- Vitamin D3 5000 IU x3
- Vitamin B12
- Vitamin C
- Magnesium glycinate
- Zinc

**Evening (21:00 / wind-down):**
- Magnesium glycinate
- Melatonin (30 min before bed)

## Sleep
- Target bedtime: 22:00
- Wind-down start: 21:00
- Routine: screens off → magnesium → reading → lights out

## Scheduled check-ins

The bot checks in four times per day (Europe/Copenhagen). Each check-in
reads this protocol and today's daily log and only asks about what's
still missing. If everything is already logged, the bot stays silent.

| Time  | What it asks about                              |
|-------|-------------------------------------------------|
| 09:00 | Sleep, morning supplements, breakfast           |
| 13:00 | Lunch (calories + protein)                      |
| 19:00 | Dinner (calories + protein)                     |
| 21:30 | Daily summary + evening supplements             |

The user can also message the bot any time to log things early — an
item logged before its scheduled check-in just means the check-in skips
that question.

## Writing convention for today's daily log

When logging an entry to today's `daily/YYYY-MM-DD.md` file, use this shape:

`## HH:MM <Slot>: <contents>`

Examples:

```
## 08:15 Breakfast: Oats with yogurt, berries, ~350 kcal, 18g protein
## 09:05 Sleep: 7h, felt rested
## 09:10 Morning supplements: omega-3, D3 x3, B12, C, magnesium, zinc
## 12:50 Lunch: Chicken sandwich + salad, ~550 kcal, 35g protein
## 18:45 Dinner: Salmon, rice, broccoli, ~700 kcal, 45g protein
## 21:35 Evening supplements: magnesium, melatonin
## 21:35 Summary: Good food day (~3200 kcal, ~170g protein), slept well, all supps in.
```

The shape is a suggestion — if prose doesn't fit (corrections, rambles,
surprise events, the user wanting to vent), break the convention and
write what fits. The goal is a log that both the user and the LLM can
skim, not a database row.

When deciding whether something is "already logged" for a check-in,
scan today's log for an entry matching the slot — `Breakfast`, `Lunch`,
`Dinner`, `Sleep`, `Morning supplements`, `Evening supplements`,
`Summary`. Freeform prose counts if the meaning is unambiguous.
