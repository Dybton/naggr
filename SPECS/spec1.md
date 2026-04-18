## Requirements (product)

Simplify naggr. The app checks in 4 times per day via Telegram.

- **Morning 9:00**
  - How did I sleep?
  - Morning supplements (from protocol) — did I take them?
  - Breakfast — calories + protein
- **Lunch 13:00**
  - Lunch — calories + protein
- **Dinner 19:00**
  - Dinner — calories + protein
- **Evening 21:30**
  - Daily summary
  - Evening supplements (from protocol) — did I take them?

At each scheduled time the bot reads today's daily log and the protocol, and only asks about what's still missing. If everything's already logged, it just acknowledges that.

I can message the bot any time to log things early. If I log breakfast at 8:00, the 9:00 check-in sees it and skips that question. Anything I forget in the morning can be filled in later at lunch, dinner, or evening.

No reminders beyond these 4 scheduled messages. No retries, no escalation, no taper logic.

Supports voice and images over Telegram.

Context within a day is preserved; earlier days are ignored entirely.

## Technical

- No regex.
- `protocol.md` — defines what to ask for (supplements, dosages, meal slots). Free-form markdown. I can edit it by telling the bot to update it.
- `daily/YYYY-MM-DD.md` — today's log. The LLM reads and writes this file directly. No schema.
- Cron jobs fire at the 4 scheduled times. Each job: read protocol, read today's daily file, ask about the gap (or acknowledge if none).
- Yesterday's files stay on disk but are never read. Today's bot has no access to earlier days.