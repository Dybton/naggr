# Heartbeat Checklist

On each heartbeat, check the current time against the protocol schedule.
Read protocol.md for the full schedule. Read today's daily log for what's
already been done.

## Quiet Hours
- **23:00 - 08:00: ALWAYS respond HEARTBEAT_OK.** No reminders, no messages.
- If the user messages during quiet hours, you can still respond to them.

## Logic
1. If current time is between 23:00 and 08:00, respond HEARTBEAT_OK immediately.
2. Check if any reminder is due (within the heartbeat window).
3. Check if the user was expected to log something and hasn't.
4. Check tapering rules before sending anything.
5. If nothing is due, respond HEARTBEAT_OK.

## Reminder types
- SUPPLEMENT_REMINDER: Send when supplement time arrives and not yet marked.
- MEAL_CHECKIN: Send at meal check-in times if no meal logged recently.
- BEDTIME_REMINDER: Send at wind-down time.
- LATE_NIGHT_NUDGE: Send if past bedtime and user sent a message recently.
- DAILY_SUMMARY: Trigger at 22:30 if user was active today.

## Tapering state
- Track in AGENTS.md under "Response Behavior".
- Read response rate before sending. Apply tapering rules from SOUL.md.
