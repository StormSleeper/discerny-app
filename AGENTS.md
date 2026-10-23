# Discerny: instructions for agents

Discerny is a task tracker and knowledge base kept as plain Markdown files in a data folder. It borrows from David Allen's Getting Things Done (GTD): new things land in an inbox, are clarified into items, and are organised by project, person and system. The user works on the files through a local web page; you, the agent, work on the same files directly. The files are the only source of truth, so the user and you always see the same state.

This file is the contract for any agent that reads or edits a Discerny data folder, and for any skill written to do so. Read it before acting.

## Terms used here

- **Discerny**: the app, its file formats and a data folder. Agents, connectors and sources sit outside it.
- **The app**: Discerny's own program: the UI, the helper, these instructions and the skills. It lives in the app folder, this folder, and holds no one's data.
- **The data folder**: a folder of Discerny files (`TASKS.md` and the rest) holding one user's items, records and the bookkeeping that goes with them. It is kept apart from the app, so the app can work with whichever data folder is connected to it: the user's own, or one for testing. In this file a bare file name such as `TASKS.md` means the file in the data folder.
- **The UI**: the web page, `discerny.html`. When this file says "the UI does X", it means the page, not you.
- **The user**: the one person the data folder belongs to. Their record in `PEOPLE.md` is the one whose note says "The user of Discerny" (normally `P-0001`).
- **The agent**: you, an AI working on the data folder from outside Discerny by following these instructions.
- **Skill**: a named set of instructions (`discern-<name>`) that ships with the app and that an agent runs on request.
- **Source skill**: a skill that reads one source (a mailbox, Teams chat, a calendar, an export) and puts proposals to the user, new items in `INBOX.md` among them. The calendar's Meetings are the exception: they go straight into `TASKS.md`.
- **Item**: one tracked thing (a task, meeting, process, document or FYI), proposed, open or done. **Record**: a person, project or system that items are about.

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
| `DONE.md` | Completed items | `ref:` lines (source keys), by source skills; otherwise only when asked |
| `INBOX.md` | Proposals for new items from source skills, waiting for the user to clarify them | during a run, and when the user asks about the inbox |
| `PEOPLE.md` | One record per person: company, department, title, manager, notes, change history | when a person is involved |
| `PROJECTS.md` | One record per project, workstream or pod (`PRJ-####`) | when an item has `prj:` or a project is named |
| `SYSTEMS.md` | One record per system or platform (`SYS-####`) | when a system is involved |
| `RELATIONSHIPS.md` | One line per relationship between items and records | search by ID |
| `REFERENCE.md` | Web addresses, people's details and other things to look up, not act on | on demand |
| `ASK-AGENT.md` | The agent queue: requests the user left for you from the UI ("Ask agent") | when running `discern-ask-agent` |
| `ASK-AGENT-LOG.md` | Append-only record of agent requests you have actioned | append only; read when asked |
| `SOURCES.md` | Settings shared by source skills (`## defaults`: time zone, priority people) and each source's state: watermark, filters, last run | by source skills; `timezone` whenever a time is written |
| `IGNORED.md` | Source keys never to be proposed again: ignored by a source skill or dismissed by the user | by source skills |
| `REFRESH-LOG.md` | Reports of source-skill runs, newest last (created on the first run) | append only; read when asked |
| `drafts/` | Messages you drafted for the user (`<ID>-<slug>.md`). Never sent | when asked |
| `DISCERNY.md` | What the folder is, and its Format version as `<!-- format: <version> -->`. No file, or no comment, means 0.1.0.0. `discern check` reports it. Only an Upgrade changes it; never edit it | never; run `discern check` |

### In the app folder

| File | Holds | Agent reads |
|---|---|---|
| `SOURCE-SKILLS.md` | The protocol every source skill follows | when running or writing a source skill |
| `tools/discern.mjs` | The helper: `connect` and `new` for the data folder, `serve` to open the UI in a browser, `upgrade` for one in an older Format, and the IDs, times, source key matching and writes source skills need | run it; never read it |
| `migrations/` | One folder per Format change, which `discern upgrade` runs. Its `README.md` says how to write one | when an Upgrade stops at a Migration's `INSTRUCTIONS.md`, or when changing the Format |
| `tools/evals/` | Recorded connector responses and expected results for testing the skills | only when testing a skill |
| `.claude/skills/` | The `discern-*` skills for Claude | when running one |
| `config.toml` | The app folder's settings. `data_folder` is the path of the connected data folder, written by `discern connect` and `discern new` | when Node is missing |
| `new_discerny_repo/` | The blank starter files for a new data folder | never, unless asked |
| `discerny.html` | The UI | never |
| `icons/` | The UI's icons | never |
| `AGENTS.md`, `CLAUDE.md`, `README.md`, `LICENSE` | Instructions and documentation | this file only |

## Rules for every edit

- Edit single lines in place. Never rewrite a whole file, and never leave a file empty: the UI refuses to save over a file that suddenly loses its contents, so keep the `#` heading and header comments in every file.
- IDs are permanent and never reused. Each file with IDs has `<!-- next-id: N -->` near the top. When you add an item, use N and then increase it. Open items and inbox items share the counter in `TASKS.md`.
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
- `dep`: optional, comma-separated IDs of this item's **dependencies**: the items that must be done before this one can start. The reverse, the items that depend on this one, is worked out by the UI and never stored. A dependency that is done or gone counts as resolved; leave the tag in place unless asked.
- `prj`: optional, comma-separated `PRJ-####` IDs. `tg`: optional, comma-separated free-text tags; the tag list is whatever the data uses.
- `asg`: when the item reached the user (message timestamp; `12:00` if only the date is known). For an item a skill derives rather than receives, such as a prep item for a meeting, the time it was derived. Set it on every item a source skill creates.
- `ref`: the item's **source key**, a hidden key that ties it to the source thread, message or event it came from, so the same thing is never proposed twice: a scheme, then keys joined by `|`. The UI never shows or edits it, and renaming the item does not affect it. An item may carry several; a meeting with a date also carries a `cal|date|subject` source key so every source recognises it. A source key ending in `|*` stands for a whole chat or thread: on an item it means "related", never "already seen" (the older bare form `teams|chat-prefix` means the same). `SOURCE-SKILLS.md` lists the schemes and how they match.
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
- A note about a system goes on the system in `SYSTEMS.md`, not as an item's `note:`.
- When a project's notes pass about ten lines, move them to `projects/<name>.md` and leave a `link:` to it on the project.

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
- `ext:Y` marks a person outside the user's organisation. `st:Left` hides someone who has left.
- `em:` lists the person's email addresses, comma-separated; `handle:` lists other names or IDs they are addressed or mentioned by. Source skills use them to recognise senders, and the user's own record to recognise the user.
- When a field changes, add a `hist:` line: `- hist: YYYY-MM-DD | Field: old → new`.

## Relationships (RELATIONSHIPS.md)

A relationship is a stored connection between two items or records, of one kind: related, concerns, involves, owns or uses. One line per relationship, stored once and shown on both:

```
- T-0007 ~ T-0032 | related
- T-#### -> SYS-#### | concerns
- T-#### -> P-#### | involves
- P-#### -> SYS-#### | owns
- PRJ-#### -> SYS-#### | uses
```

Both IDs must exist; no duplicates; nothing related to itself. `dep:` stays on the item and is not a relationship. A `link:` line on an item or record holds a URL, not a relationship.

## Agent queue (ASK-AGENT.md)

The user leaves agent requests for you from the UI ("Ask agent"). They wait in the agent queue, one line each:

```
- T-0025 | 2026-10-08 18:02 | the request
```

Line breaks inside a request are written as ` ⏎ `. The ID is the item or record the request is about. To work through the queue (this is what `discern-ask-agent` does):

1. Read `ASK-AGENT.md`. Take the requests oldest first.
2. For each request, find the item or record by its ID and do what it asks, within the data folder: update a record, add sub-tasks, add a URL or a relationship, answer a question as a `note:`, or write a draft.
3. If the request needs something only the user can give (their name, a decision), ask them in the conversation. If they are not there, leave the request in the queue and say so.
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

5. When a request is done, remove its line from `ASK-AGENT.md` and append one line to `ASK-AGENT-LOG.md`:
   `- YYYY-MM-DD HH:MM | ID | queued YYYY-MM-DD HH:MM | the request | what you did`
6. Finish with a short summary: what you did for each request, and which requests are still waiting and why.

## Sources, runs and refresh

A source is anything outside Discerny that a source skill reads: a mailbox, Teams chat, a calendar, an export. A run is one source skill reading its source once; a refresh is running every source skill in turn (`discern-refresh`). Discerny itself never talks to an outside system, so any connector the agent has can be used. Before running or writing a source skill, read `SOURCE-SKILLS.md`: it holds the loop every source skill follows, and how to use the helper, `tools/discern.mjs`, which does the deterministic parts. In short:

1. A `discern-<source>` skill reads the shared `## defaults` block and its own `## <source-name>` block in `SOURCES.md`. For a stream source, such as a mailbox or Teams chat, it asks its connector only for messages after its cursor (`watermark` less `overlap`), in day-long windows. A horizon source, such as a calendar, re-reads a window ahead of now on every run instead.
2. Each thing it finds is a candidate, which the skill assesses. A candidate whose source key already appears in `TASKS.md`, `INBOX.md`, `DONE.md` or `IGNORED.md` is already tracked: it is skipped, or becomes a proposed change to the existing item, which appears only in the run report.
3. The rest are ignored as noise, or written to `INBOX.md` as proposals for new items, with new IDs (shared counter), `src:`, `ref:` and `asg:`. Then the cursor moves past the last window fully processed. A run reads at most `page_cap` pages a pass, so after a gap a stream source takes several runs to catch up: its report ends by saying whether it is caught up, and a refresh runs it again while it isn't. Meetings come from the calendar: a horizon source writes each Meeting in its window straight into `TASKS.md` as an open `ty:Meeting` item and keeps it in step with the calendar, but never marks one done; the mail skill leaves invitations to it.
4. The user clarifies each proposal in the UI's inbox: Accept moves the item to `TASKS.md`; Dismiss logs its source key in `IGNORED.md`.

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

`IGNORED.md` lines are `ref | YYYY-MM-DD | reason`. Parse them from the right, because a source key may contain ` | `.

## Testing a change to the UI

When you change `discerny.html`, open it in a browser on a throwaway copy of a data folder and check the change there. A served page writes real files, so the copy is what keeps the user's own data out of the test.

1. Make the copy in a temporary folder. If `discerny-example` sits beside the app folder, copy it (it is the Example, the data folder of a made-up company). Otherwise run `node tools/discern.mjs connect` and note the `folder` it prints, then `node tools/discern.mjs new <tmp>`, which makes a blank folder and connects the app to it.
2. Start `node tools/discern.mjs serve --dir <tmp> --port 0` in the background. Once listening it prints one line of JSON, `{"url", "folder"}`; check that `folder` is the copy.
3. Open `url` in a browser (a headless one works) and try the change. The files in `<tmp>` show what the page saved, and an edit you make there shows up on the page within a few seconds.
4. Stop the server and delete `<tmp>`. If you used `new`, run `node tools/discern.mjs connect <folder>` with the folder you noted, so the user's own folder is connected again.

## Writing a skill for Discerny

Every `discern-*` skill, whoever writes it, must:

- Live in the app folder, beside the others: for Claude, `.claude/skills/discern-<name>/SKILL.md`; another agent uses its own skills folder there.
- Read this file when it runs (and `SOURCE-SKILLS.md`, for a source skill), rather than copying the formats into the skill, so the skill keeps working when the formats change. Find the data folder as "Start here" says; never hard-code its path.
- Follow "Rules for every edit" above.
- Be read-only towards outside systems. Anything that would act outside the data folder becomes a draft in `drafts/`.
- If it is a source skill: follow `SOURCE-SKILLS.md`. New items go only to `INBOX.md`, never straight to `TASKS.md`, except a horizon source's Meetings, which `discern meetings` writes there; its other writes are the bookkeeping that file lists, made through `tools/discern.mjs`.
- End with a one-line result in the style of `last_result` (what was read, skipped and proposed), and record it in `SOURCES.md` if it is a source skill.
