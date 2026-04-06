---
name: check-status
description: "Show today's progress summary — calories, protein, supplements, and overall status."
metadata:
  openclaw:
    emoji: "📊"
---

# Check Status

Use this skill when someone asks how Jakob is doing today.

## When to Use

- Jakob asks "how am I doing?", "status", "where am I at?"
- Laerke asks about Jakob's day ("did he eat lunch?", "how's he doing?")
- Any request for a progress check

## Procedure

1. **Read today's daily log.** Open `daily/YYYY-MM-DD.md`.

2. **Compile status.** Gather:
   - Calories consumed vs target (with percentage)
   - Protein consumed vs target (with percentage)
   - Number of meals logged
   - Supplement compliance (how many taken vs total)
   - Exercise status (if logged)
   - Any notes

3. **Respond with a brief summary.** Format for WhatsApp (no tables, no headers):

   Example:
   ```
   Today so far:
   🍽️ 1750/2800 kcal (62%) — 3 meals logged
   💪 105/180g protein (58%)
   💊 3/4 supplements taken
   🏋️ Rest day

   You've got dinner and a snack left — should get you there.
   ```

4. **Add context if helpful.** If they're behind on protein, mention it gently. If they're on track, acknowledge it.

## For Laerke

When Laerke asks, provide the same info but frame it as reporting on Jakob. Keep it factual — she knows the protocol.

## Do NOT

- Give advice or suggestions unless asked.
- Show raw data dumps.
- Use markdown tables (WhatsApp doesn't render them).
