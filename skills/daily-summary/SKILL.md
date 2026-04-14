---
name: daily-summary
description: "End-of-day summary triggered by heartbeat at 22:30 — compile stats, update streaks, close the day."
metadata:
  emoji: "📝"
---

# Daily Summary

Use this skill at end-of-day (triggered by heartbeat around 22:30) to close out the daily log.

## When to Use

- Heartbeat triggers at/after 22:30 and user was active today
- User explicitly asks for a daily summary

## Procedure

1. **Read today's daily log.** Open `daily/YYYY-MM-DD.md`.

2. **Compile final stats:**
   - Total calories vs target
   - Total protein vs target
   - Meals logged count
   - Supplement compliance (X out of Y)
   - Exercise (if any)
   - Sleep notes (if bedtime was reported)

3. **Update streaks in AGENTS.md:**
   - If all supplements taken: increment supplement streak
   - If food was logged: increment food logging streak
   - If any streak was broken: reset to 0, note it without drama

4. **Send summary message** (only if user was active today — don't send to someone who didn't engage):

   Example:
   ```
   End of day, Jakob 📝

   🍽️ 2650/2800 kcal (95%) — solid
   💪 170/180g protein (94%)
   💊 4/4 supplements ✓ — 13 days running
   🏋️ Rest day

   Good day. See you tomorrow.
   ```

5. **Prepare tomorrow's log.** Create `daily/YYYY-MM-DD.md` for tomorrow with the blank template (meals empty, supplements unchecked, totals at zero).

## Tone

- Brief and factual.
- Positive when earned, neutral when not.
- Never guilt-trip about missed targets.
- Identity affirmations on milestone streaks.

## Do NOT

- Send a summary if the user was completely inactive today (no messages, no logs).
- Write more than 5-6 lines.
- Suggest improvements unless explicitly asked.
