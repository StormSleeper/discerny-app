# Dismissed
<!-- One line per source key of a Proposal the user dismissed, kept until its source can no longer read
     the message again: `- <source key> {source: <source name>; received-datetime: YYYY-MM-DD HH:MM;
     dismissed-date: YYYY-MM-DD; reason: not actionable}`, local time in `timezone`.
     A line from a horizon source has `event-date: YYYY-MM-DD` in place of `received-datetime`.
     Parse the braces from the final " {".
     tools/discern.mjs removes a line on commit once its source has moved past it. -->
