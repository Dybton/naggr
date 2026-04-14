---
name: log-supplement
description: "Mark supplements as taken in the daily log and update streak count."
metadata:
  emoji: "💊"
---

# Log Supplement

Use this skill when the user confirms taking one or more supplements.

## When to Use

- User responds to a supplement reminder with "done", "took them", "yes", thumbs up, etc.
- User proactively reports taking supplements ("just took my magnesium")
- Any confirmation of supplement intake

## Procedure

1. **Determine which supplements.** Based on:
   - The reminder that was just sent (context of the conversation)
   - The time of day (match against protocol.md schedule)
   - Explicit mention ("took my omega-3")
   - If ambiguous, mark all supplements due at this time window

2. **Update daily log.** Open `daily/YYYY-MM-DD.md`. In the `## Supplements` section, change the relevant entries from `- [ ]` to `- [x]` with timestamp:
   ```
   - [x] Omega-3 (08:15) ✓
   ```

3. **Update streak in AGENTS.md.** Read current streak count under `### Current Streak`. If all supplements for today are now marked, increment the streak. If this is the first check of the day, verify yesterday's log to confirm streak continuity.

4. **Respond briefly.** One short confirmation:
   - "Noted ✓ That's 13 days running."
   - If a milestone streak (7, 14, 21, 30): celebrate briefly with an identity affirmation.
   - Example at 14 days: "14 days. You're someone who shows up for this. 💪"

## Do NOT

- Ask which supplements they took if context makes it obvious.
- Send long congratulatory messages — keep it to one sentence.
- Nag about missed supplements in this skill (that's the heartbeat's job).
