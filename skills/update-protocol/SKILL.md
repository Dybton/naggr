---
name: update-protocol
description: "Update the health protocol via natural language — change supplements, reminder times, targets, or preferences."
metadata:
  openclaw:
    emoji: "⚙️"
---

# Update Protocol

Use this skill when the user wants to change anything about their health protocol.

## When to Use

- "Move my magnesium to 20:30"
- "Add zinc to my supplements"
- "Remind me at 9pm instead"
- "Change my protein target to 200g"
- "Don't remind me on weekends"
- "Be less chatty" / communication preference changes
- Any request to modify the protocol

## Procedure

1. **Read current protocol.md.** Understand the full current state.

2. **Interpret the change.** Map the natural language request to a specific edit:
   - Supplement changes: add/remove/modify entries in the supplements table
   - Timing changes: update the reminders schedule
   - Target changes: update diet/exercise/sleep numbers
   - Preference changes: update communication rules or constraints

3. **Apply the edit.** Write the updated section to protocol.md. Keep the file format consistent — preserve the existing structure.

4. **Handle cascading changes.** If changing a supplement time, also check if the reminder schedule needs updating. If changing bedtime, check wind-down timing.

5. **Confirm the change.** Brief, clear confirmation:
   - "Done — magnesium moved to 20:30. I'll remind you then."
   - "Added zinc 25mg at breakfast. I'll include it in your morning reminder."

## What Can Be Updated

- Add/remove/change supplements (name, dose, timing, anchor habit)
- Adjust reminder times
- Change calorie/macro targets
- Update sleep schedule (bedtime, wind-down start)
- Modify exercise plan
- Change communication preferences

## Do NOT

- Make changes without confirming what you understood.
- Change multiple things at once without listing them all in your confirmation.
- Edit SOUL.md through this skill (that's identity, not protocol).
