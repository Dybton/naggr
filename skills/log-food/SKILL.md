---
name: log-food
description: "Log a meal from text, image, or voice input. Estimates macros via LLM, appends to daily log, updates running totals."
metadata:
  emoji: "🍽️"
---

# Log Food

Use this skill when the user (Jakob or Laerke) reports a meal or food intake.

## When to Use

- User sends text describing a meal ("4 eggs scrambled, 2 slices rye bread")
- User sends a food photo (with or without text description)
- User sends a voice message about food (transcription is handled upstream)
- Laerke reports what Jakob ate ("Jakob had chicken for lunch")

## Procedure

1. **Parse the input.** Identify:
   - What foods were consumed
   - Approximate portions (use reasonable defaults if not specified)
   - Meal type (breakfast/lunch/dinner/snack) based on time of day
   - Who reported it (Jakob or Laerke on his behalf)

2. **Estimate macros.** For each food item, estimate:
   - Calories (kcal)
   - Protein (g)
   - Carbs (g)
   - Fat (g)
   Use reasonable estimates. These are for awareness, not precision. When an image is provided, use it to refine portion estimates.

3. **Append to daily log.** Open `daily/YYYY-MM-DD.md` (create if it doesn't exist). Add a new meal entry under `## Meals`:

   ```
   ### [Meal type] (HH:MM)
   - Reported: "[user's original text or description of image]"
   - Estimated: ~[X] kcal | P: [X]g | C: [X]g | F: [X]g
   ```

4. **Recompute running totals.** Read ALL meal entries for today, sum them fresh (don't accumulate — recompute from entries to stay consistent). Update the `## Running Totals` section.

5. **Check for unlogged earlier items.** After logging the meal, check today's daily log against the protocol schedule (`protocol.md`) for items that should have been done *before* this meal but aren't logged yet. For example, if the user logs lunch but morning supplements aren't checked off, ask about them. When asking:
   - **Name each item with its specific dose** from the protocol table — e.g., "Did you take your Vitamin D3 (5000 IU x3), Zinc, and Magnesium this morning?"
   - Keep it casual, one short follow-up question at the end of the confirmation.
   - Only ask about items whose scheduled time has passed (don't ask about evening supplements at lunchtime).

6. **Respond briefly.** One message, 1-2 sentences:
   - Confirm the log
   - Show the estimate
   - Show progress toward daily target
   - If there are unlogged earlier items (from step 5), append a casual follow-up question naming them with doses
   - Example: "Got it — ~750 kcal, 50g protein. You're at 1750/2800 for today. Btw, did you take your Vitamin D3 (5000 IU x3), Zinc, and Magnesium this morning?"

## Tips for Better Estimates

- If the user sends both text AND an image, use both for a better estimate.
- Encourage the text+photo combo naturally when estimates seem uncertain.
- Danish food portions: use typical Danish serving sizes as defaults.
- When unsure, estimate conservatively and note the uncertainty.

## Do NOT

- Ask for exact gram measurements — this is about low-friction logging.
- Send long breakdowns unless specifically asked.
- Question food choices or give dietary advice.
