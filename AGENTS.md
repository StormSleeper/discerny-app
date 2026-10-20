# Discerny: instructions for agents

Discerny is a task tracker and knowledge base kept as plain Markdown files in a data folder. It borrows from David Allen's Getting Things Done (GTD): new things land in an inbox, get triaged into tasks, and are organised by project, person and system. The user works on the files through a local web page; you, the agent, work on the same files directly. The files are the only source of truth, so the user and you always see the same state.

This file is the contract for any agent that reads or edits a Discerny data folder, and for any skill written to do so. Read it before acting.

## Terms used here

- **Discerny**: the whole system: the app, the file formats and the user's data.
- **The app folder**: this folder. It holds the UI, the helper, the skills and these instructions, and none of the user's data.
- **The data folder**: the folder that holds the user's files (`TASKS.md` and the rest). It is kept apart from the app, so the app can work with any data folder: the user's own, or one for testing. In this file a bare file name such as `TASKS.md` means the file in the data folder.
- **The UI**: the web page, `discerny.html`. When this file says "the UI does X", it means the page, not you.
- **The user**: the person the data folder belongs to. Their record in `PEOPLE.md` is the one whose note says "The user of Discerny" (normally `P-0001`).
- **Skill**: a reusable set of instructions an agent runs on request. Discerny skills are named `discern-<name>`.
- **Source skill**: a skill that reads one outside source (mail, chat, a calendar, an export) and proposes items into `INBOX.md`.

## Start here

1. Find the data folder: run `node tools/discern.mjs connect` in the app folder, which prints it as `folder`. Without Node, it is `data_folder` in `config.toml` in the app folder: a path in single quotes as written, or in double quotes with `\\` and `\"` standing for `\` and `"`. If none is connected (exit 2), ask the user which folder holds their Discerny data and run `node tools/discern.mjs connect <folder>`; to start a new one, `node tools/discern.mjs new <folder>` copies the starter files and connects to the copy. Never write data files into the app folder.
2. If the helper refuses the data folder because of its Format (exit 2, naming the folder's Format and the app's), do no work on it. Tell the user what the message says. For an older folder, offer the Upgrade: they can ask you to "upgrade my Discerny folder", which the `discern-upgrade` skill does. Never edit the folder by hand, `DISCERNY.md` included, to get past the refusal.
3. Read only what the request needs. Do not read every file. The tables below say when each file is needed.
4. Find items by searching for their ID (`T-0012`, `P-0003`, `PRJ-0001`, `SYS-0002`), then read or edit only those lines.
5. Ignore `new_discerny_repo/` in the app folder. It holds the blank starter files a new data folder is copied from. Never read or change it unless the user asks you to.
6. `README.md` is for people. You do not need it.

## Files

### In the data folder

| File | Holds | Agent reads |
|---|---|---|
| `TASKS.md` | Open items, flat list in ID order | by default |
| `DONE.md` | Completed items | `ref:` lines, by source skills for dedupe; otherwise only when asked |
| `INBOX.md` | Candidates proposed by source skills, waiting for triage | during refresh and triage |
| `PEOPLE.md` | One record per person: company, department, title, manager, notes, change history | when a person is involved |
| `PROJECTS.md` | One record per project, workstream or pod (`PRJ-####`) | when a task has `prj:` or a project is named |
| `SYSTEMS.md` | One record per system or platform (`SYS-####`) | when a system is involved |
| `RELATIONSHIPS.md` | One line per link between items | search by ID |
| `REFERENCE.md` | Stable links and contacts | on demand |
| `ASK-AGENT.md` | Notes and requests the user queued for you from the UI ("Ask agent") | when running `discern-ask-agent` |
| `ASK-AGENT-LOG.md` | Append-only record of queue notes you have actioned | append only; read when asked |
| `SOURCES.md` | Settings shared by source skills (`## defaults`: time zone, priority people) and each source's state: watermark, filters, last run | by source skills; `timezone` whenever a time is written |
| `IGNORED.md` | Threads already judged not actionable | by source skills, for dedupe |
| `REFRESH-LOG.md` | Reports of source-skill runs, newest last (created on the first run) | append only; read when asked |
| `drafts/` | Messages you drafted for the user (`<ID>-<slug>.md`). Never sent | when asked |
| `DISCERNY.md` | What the folder is, and its Format version as `<!-- format: <version> -->`. No file, or no comment, means 0.1.0.0. `discern check` reports it. Only an Upgrade changes it; never edit it | never; run `discern check` |

### In the app folder

| File | Holds | Agent reads |
|---|---|---|
| `SOURCE-SKILLS.md` | The protocol every source skill follows | when running or writing a source skill |
| `tools/discern.mjs` | The helper: `connect` and `new` for the data folder, `serve` to open the UI in a browser, `upgrade` for one in an older Format, and the IDs, times, dedupe and writes source skills need | run it; never read it |
| `migrations/` | One folder per Format change, which `discern upgrade` runs. Its `README.md` says how to write one | when an Upgrade stops at a Migration's `INSTRUCTIONS.md`, or when changing the Format |
| `tools/evals/` | Recorded connector responses and expected results for testing the skills | only when testing a skill |
| `.claude/skills/` | The `discern-*` skills for Claude | when running one |
| `config.toml` | The app folder's settings. `data_folder` is the path of the connected data folder, written by `discern connect` and `discern new` | when Node is missing |
| `new_discerny_repo/` | The blank starter files for a new data folder | never, unless asked |
| `discerny.html` | The UI | never |
| `AGENTS.md`, `CLAUDE.md`, `README.md`, `LICENSE` | Instructions and documentation | this file only |

## Rules for every edit

- Edit single lines in place. Never rewrite a whole file, and never leave a file empty: the UI refuses to save over a file that suddenly loses its contents, so keep the `#` heading and header comments in every file.
- IDs are permanent and never reused. Each file with IDs has `<!-- next-id: N -->` near the top. When you add an item, use N and then increase it. Tasks and inbox items share the counter in `TASKS.md`.
- Work only inside the data folder; change the app folder only when the user asks you to change Discerny itself: its UI, helper, instructions or skills. Never send, reply to, move or mark anything in an outside system (mail, chat, calendars). If the user wants a message sent, write a draft in `drafts/` and tell them.
- The UI may be open while you work. It notices your edits and does not overwrite them, but it is safest to edit only the lines you need.
- When you are unsure what the user meant, ask. If no one is there to answer, leave the item as it is and say why.
- Times without a time zone are the user's local time: the `timezone` in the `## defaults` block of `SOURCES.md`. State in `SOURCES.md` is UTC.

## Item format (TASKS.md, INBOX.md, DONE.md)

```
- [ ] T-0012 Title text {ty:Task; who:Person Name; prj:PRJ-0001; tg:Tag1,Tag2; urg:today|week|soon|later|fyi; p:1-3; due:YYYY-MM-DD[ HH:MM]; st:Waiting|In progress; dep:T-0003; asg:YYYY-MM-DD HH:MM}
  - src: where it came from
  - note: context from the agent or the source
  - link: [label](https://…)
  - ref: scheme|key   for example mail|normalised subject, teams|chat|messageId, cal|date|subject
  - my: the user's own notes (one line each)
  - [ ] sub-task
```

- `ty`: Task, Meeting, Process, Document or FYI.
- `who`: the person the item is with or waiting on. Must match a name in `PEOPLE.md` exactly; if no record matches, leave `who` out and name the person in a `note:`.
- `urg`: today, week, soon, later or fyi. `p`: 1 high, 2 medium, 3 low.
- `due`: `YYYY-MM-DD`, or `YYYY-MM-DD HH:MM` when a time is known. Every `ty:Meeting` with a known date and time must carry the time.
- `st`: optional. `Waiting` means the user is waiting on someone else; `In progress` means started.
- `dep`: optional, comma-separated IDs this item is **blocked by**. "Blocks" is worked out by the UI and never stored. A blocker that is done or gone counts as resolved; leave the tag in place unless asked.
- `prj`: optional, comma-separated `PRJ-####` IDs. `tg`: optional, comma-separated free-text tags; the tag list is whatever the data uses.
- `asg`: when the item reached the user (message timestamp; `12:00` if only the date is known). For an item a skill derives rather than receives, such as a prep task for a meeting, the time it was derived. Set it on every item a source skill creates.
- `ref`: a hidden dedupe key that ties the item to its source thread: a scheme, then keys joined by `|`. The UI never shows or edits it, and renaming the item does not affect it. An item may carry several; a meeting with a date also carries a `cal|date|subject` ref so every source recognises it. A ref ending in `|*` stands for a whole chat or thread: on a task it means "related", never "already seen" (the older bare form `teams|chat-prefix` means the same). `SOURCE-SKILLS.md` lists the schemes and how they match.
- `note:` is for your context and the source's; the UI's "Details" box also writes `note:`. `my:` is the user's own notes; never edit or remove them unless asked.
- `top:` is retired. The UI still reads it on old items; never write it.
- Completing an item means moving it to `DONE.md` as `[x]` with `done:YYYY-MM-DD`. The UI does this itself; do it only when asked.

## Projects and systems (PROJECTS.md, SYSTEMS.md)

```
- Title {id:PRJ-0001; type:Project|Workstream|Pod; parent:PRJ-0000; st:Active|On hold|Done}
  - note: description
  - link: [label](https://…)
- Name {id:SYS-0001; type:Platform|Application|Instrument|…; owner:Person Name; st:Live; part-of:SYS-0000}
  - note: free text
  - link: [label](https://…)
```

- Optional `## Group` headings.
- A note about a system goes on the system in `SYSTEMS.md`, not as a task `note:`.
- When a project's notes pass about ten lines, move them to `projects/<name>.md` and leave a link on the project.

## People (PEOPLE.md)

```
## Group heading
- Full Name {id:P-0001; co:Company or business unit; dept:Department; title:Job title; mgr:Manager Name; ext:Y; st:Left; chk:YYYY-MM-DD; em:name@example.com; handle:staff-id}
  - note: free text
  - hist: 2026-10-06 | Job title: old → new
```

- The name must match `who:` on items, `owner:` on systems and `mgr:` on people. The UI never renames people; if you rename someone, update every one of those references in the same piece of work.
- `id` (`P-####`) never changes, even when the name is corrected. Use it when referring to a person in chat.
- Blank `co`, `dept`, `title` or `mgr` counts as missing and shows on the UI's People page. `chk` is the date the record was last checked; set it when you change a field.
- `ext:Y` marks an external contact. `st:Left` hides someone who has left.
- `em:` lists the person's email addresses, comma-separated; `handle:` lists other names or IDs they are addressed or mentioned by. Source skills use them to recognise senders, and the user's own record to recognise the user.
- When a field changes, add a `hist:` line: `- hist: YYYY-MM-DD | Field: old → new`.

## Relationships (RELATIONSHIPS.md)

One line per link, stored once and shown on both items:

```
- T-0007 ~ T-0032 | related
- T-#### -> SYS-#### | concerns
- T-#### -> P-#### | involves
- P-#### -> SYS-#### | owns
- PRJ-#### -> SYS-#### | uses
```

Both IDs must exist; no duplicates; no self-links. `dep:` stays on the task and is not a relationship.

## Ask-agent queue (ASK-AGENT.md)

The user leaves notes for you from the UI ("Ask agent"). Each is one line:

```
- T-0025 | 2026-10-08 18:02 | the request
```

Line breaks inside a note are written as ` ⏎ `. The ID is the item the note is about (a task, person, project or system). To work through the queue (this is what `discern-ask-agent` does):

1. Read `ASK-AGENT.md`. Take the notes oldest first.
2. For each note, find the item by its ID and do what it asks, within the data folder: update a record, add sub-tasks, add a link, answer a question as a `note:`, or write a draft.
3. If the note needs something only the user can give (their name, a decision), ask them in the conversation. If they are not there, leave the note in the queue and say so.
4. Drafts go in `drafts/<ID>-<slug>.md`, in this form, and are never sent:

   ```
   # Draft – not sent

   - For: T-0007 (short label)
   - Requested: YYYY-MM-DD HH:MM via Ask agent
   - Channel: email | chat
   - To: Name <address>
   - Subject: …

   ---

   body
   ```

5. When a note is done, remove its line from `ASK-AGENT.md` and append one line to `ASK-AGENT-LOG.md`:
   `- YYYY-MM-DD HH:MM | ID | queued YYYY-MM-DD HH:MM | the note | what you did`
6. Finish with a short summary: what you did for each note, and which notes are still waiting and why.

## Sources and refresh

Source skills bring outside items into the inbox. Discerny itself never talks to an outside system, so any connector the agent has can be used. Before running or writing a source skill, read `SOURCE-SKILLS.md`: it holds the loop every source skill follows, and how to use the helper, `tools/discern.mjs`, which does the deterministic parts. In short:

1. A `discern-<source>` skill reads the shared `## defaults` block and its own `## <source-name>` block in `SOURCES.md`, and asks its connector only for items after its cursor (`watermark` less `overlap`), in day-long windows. A calendar-like source re-reads a window ahead of now instead.
2. Anything whose `ref` already appears in `TASKS.md`, `INBOX.md`, `DONE.md` or `IGNORED.md` is skipped, or proposed as an update to the existing item.
3. The rest are written to `INBOX.md` as items with new IDs (shared counter), `src:`, `ref:` and `asg:`. Then the cursor moves past the last window fully processed.
4. The user triages in the UI: Accept moves an item to `TASKS.md`; Dismiss logs its `ref` in `IGNORED.md`.

`SOURCES.md` starts with `## defaults`, then one block per source; each skill adds keys of its own:

```
## defaults
- timezone: Europe/London
- priority_people: P-0002, P-0007
- personal_domains: gmail.com, outlook.com
- apply_task_updates: false
- page_cap: 10
- log_runs: true

## outlook-mail
- watermark: 2026-10-08T15:05:41Z
- overlap: PT2H
- exclude_subject:
  - (?i)newsletter
- exclude_sender:
  - no-reply@
- last_run: 2026-10-08T21:14:03Z
- last_result: fetched 11 · filtered 7 · duplicates 1 · inbox +3
```

`IGNORED.md` lines are `ref | YYYY-MM-DD | reason`. Parse them from the right, because a `ref` may contain ` | `.

## Testing a change to the UI

When you change `discerny.html`, open it in a browser on a throwaway copy of a data folder and check the change there. A served page writes real files, so the copy is what keeps the user's own data out of the test.

1. Make the copy in a temporary folder. If `discerny-example` sits beside the app folder, copy it (it is the test data folder). Otherwise run `node tools/discern.mjs connect` and note the `folder` it prints, then `node tools/discern.mjs new <tmp>`, which makes a blank folder and connects the app to it.
2. Start `node tools/discern.mjs serve --dir <tmp> --port 0` in the background. Once listening it prints one line of JSON, `{"url", "folder"}`; check that `folder` is the copy.
3. Open `url` in a browser (a headless one works) and try the change. The files in `<tmp>` show what the page saved, and an edit you make there shows up on the page within a few seconds.
4. Stop the server and delete `<tmp>`. If you used `new`, run `node tools/discern.mjs connect <folder>` with the folder you noted, so the user's own folder is connected again.

## Writing a skill for Discerny

Every `discern-*` skill, whoever writes it, must:

- Live in the app folder, beside the others: for Claude, `.claude/skills/discern-<name>/SKILL.md`; another agent uses its own skills folder there.
- Read this file when it runs (and `SOURCE-SKILLS.md`, for a source skill), rather than copying the formats into the skill, so the skill keeps working when the formats change. Find the data folder as "Start here" says; never hard-code its path.
- Follow "Rules for every edit" above.
- Be read-only towards outside systems. Anything that would act outside the data folder becomes a draft in `drafts/`.
- If it is a source skill: follow `SOURCE-SKILLS.md`. New items go only to `INBOX.md`, never straight to `TASKS.md`; its other writes are the bookkeeping that file lists, made through `tools/discern.mjs`.
- End with a one-line result in the style of `last_result` (what was read, skipped and added), and record it in `SOURCES.md` if it is a source skill.
