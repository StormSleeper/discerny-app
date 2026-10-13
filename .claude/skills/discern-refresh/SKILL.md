---
name: discern-refresh
description: Runs every Discerny source skill that has a block in SOURCES.md, one after another, and combines their reports. Use when asked to refresh Discerny, run all sources, or check everything for new items.
---

# discern-refresh

1. In the Discerny data folder's `SOURCES.md` ("Start here" in `AGENTS.md` says how to find the folder), list the `## ` block names other than `defaults`.
2. Map each block to its skill: `outlook-mail` to discern-outlook-mail, `teams-chat` to discern-teams, `outlook-calendar` to discern-outlook-calendar, and any other name to `discern-<name>` if that skill exists. A block with no skill is reported, not run.
3. Run the skills one after another, mail before Teams before the calendar, then any others, each by its own instructions. Keep one task-list item per source. A source that stops, because its connector is missing or it has a question for the user, doesn't stop the others: note why and carry on.
4. Report one section per source in run order, each starting with its counts line. Then, once at the end, everything that needs the user: their questions, and the settings and people proposed.
