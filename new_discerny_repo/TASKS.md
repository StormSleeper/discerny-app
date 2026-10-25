# Tasks
<!-- next-id: 4 -->

- [ ] T-0001 Connect your agent to this Discerny data folder {type: task; who: User; projects: PRJ-0001; tags: Setup; urgency: today; priority: high}
  - origin: Discerny starter task
  - description: Discerny works with any agent that can read and edit files and follow AGENTS.md. Your agent needs two folders: the Discerny app folder, which holds AGENTS.md, and this data folder. Tell the app where this folder is by running "node tools/discern.mjs connect <this folder>" in the app folder (not needed if you made this folder with "discern new"). The steps below are for a Claude project. For Claude Code, start it in the app folder with "claude --add-dir <this folder>" and go straight to the last step. Most other coding agents read AGENTS.md automatically.
    
    Project instruction to paste: "Before doing anything else, read AGENTS.md in my mounted Discerny app folder and follow it. My data is in my mounted Discerny data folder. If either folder is not mounted, stop and ask me to mount it."
  - [ ] Create a Claude project called Discerny
  - [ ] Add the project instruction above to the project
  - [ ] Connect (mount) both folders to the project: the Discerny app folder and this data folder
  - [ ] Check it works: ask "What's in my Discerny inbox?"
- [ ] T-0002 Create the discern-ask-agent skill {type: task; who: User; projects: PRJ-0001; tags: Setup; urgency: today; priority: high; dependencies: T-0001}
  - origin: Discerny starter task
  - description: This skill works through the agent requests you leave in the Discerny UI: an item's Agent tab, or Ask agent on a person, project or system. They wait in ASK-AGENT.md. Discerny includes it in .claude/skills/discern-ask-agent in the app folder. Claude Code finds it there, so you can tick this off. For a Claude project, zip that folder and add it as a skill in your Claude account. For any other agent, use the prompt below.
    
    Prompt to paste: "Read AGENTS.md in my Discerny app folder. Then create a skill called discern-ask-agent that works through ASK-AGENT.md exactly as the section 'Agent queue' describes, and follows the section 'Writing a skill for Discerny'. Keep the skill short: tell it to read AGENTS.md each time it runs rather than copying the file formats into the skill. Show me the skill before you save it."
- [ ] T-0003 Run discern-ask-agent for the first time {type: task; who: User; projects: PRJ-0001; tags: Setup; urgency: today; priority: high; dependencies: T-0002}
  - origin: Discerny starter task
  - description: Ask your agent to "run discern-ask-agent". It will pick up the request queued on P-0001 and ask for your name and job details, then update your record and every place that still says "User".
