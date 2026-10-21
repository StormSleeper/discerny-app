---
name: discern-refresh
description: Runs every Discerny source skill that has a block in SOURCES.md, one after another, runs a source again while it is behind, and combines their reports. Use when asked to refresh Discerny, run all sources, or check everything for new items.
---

# discern-refresh

1. In the Discerny data folder's `SOURCES.md` ("Start here" in `AGENTS.md` says how to find the folder), list the `## ` block names other than `defaults`.
2. Map each block to its skill: `outlook-mail` to discern-outlook-mail, `teams-chat` to discern-teams, `outlook-calendar` to discern-outlook-calendar, and any other name to `discern-<name>` if that skill exists. A block with no skill is reported, not run.
3. Run the skills one after another, mail before Teams before the calendar, then any others, each by its own instructions. Never run two at once, not even in sub-agents: the helper's ID counter isn't safe with two writers. Track each source as its own step in your progress list. A source that stops, because its connector is missing or it has a question for the user, doesn't stop the others: note why and carry on.
4. A stream source's report ends with whether it is caught up. While it ends "run again", run that skill again, up to 5 Runs of it in all, before moving on to the next source. Where you can start sub-agents, give each Run its own fresh one, with the skill's name and the data folder, and wait for it to finish; where you can't, run each source once and leave its "run again" in the report.
5. Report one section per source in run order, each starting with its counts line, one per Run. Then, once at the end, everything that needs the user: their questions, the settings and people proposed, and each source still behind, with its last "days still to read" line.
