# Discerny: instructions for agents

Discerny is a task tracker and knowledge base kept as plain Markdown files in a data folder. It borrows from David Allen's Getting Things Done (GTD): new things land in an inbox, are clarified into items, and are organised by project, person and system. The user works on the files through a local web page; you, the agent, work on the same files directly. The files are the only source of truth, so the user and you always see the same state.

This file is the contract for any agent that reads or edits a Discerny data folder, and for any skill written to do so. Read it before acting.

## Terms used here

- **Discerny**: the app, its file formats and a data folder. Agents, connectors and sources sit outside it.
- **The app**: Discerny's own program: the UI, the helper, these instructions and the skills. It lives in the app folder, this folder, and holds no one's data.
- **The data folder**: a folder of Discerny files (`TASKS.md` and the rest) holding one user's items, records and the bookkeeping that goes with them. It is kept apart from the app, so the app can work with whichever data folder is connected to it: the user's own, or one for testing. In this file a bare file name such as `TASKS.md` means the file in the data folder.
- **The UI**: the web page, `discerny.html`. When this file says "the UI does X", it means the page, not you.
- **The user**: the one person the data folder belongs to. Their record in `PEOPLE.md` is always `P-0001`, and that ID is never given to anyone else.
- **The agent**: you, an AI working on the data folder from outside Discerny by following these instructions.
- **Skill**: a named set of instructions (`discern-<name>`) that ships with the app and that an agent runs on request.
- **Source skill**: a skill that reads one source (a mailbox, Teams chat, a calendar, an export) and puts proposals to the user, new items in `INBOX.md` among them. The calendar's Meetings are the exception: they go straight into `TASKS.md`.
- **Item**: one tracked thing (a task, meeting, process, document or FYI), proposed, open or done. **Record**: a person, project or system that items are about.
- **Description**: what an item or record is, written once by whoever creates it. **Comment**: a timestamped addition to an item or record, with its author. See "Descriptions and Comments".

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
| `INBOX.md` | Proposals from source skills, waiting for the user to clarify them: new items, then changes under `## Changes` | during a run, and when the user asks about the inbox |
| `PEOPLE.md` | One record per person: company, department, title, manager, Description, Comments, change history | when a person is involved |
| `PROJECTS.md` | One record per project, workstream or pod (`PRJ-####`) | when an item has `prj:` or a project is named |
| `SYSTEMS.md` | One record per system or platform (`SYS-####`) | when a system is involved |
| `RELATIONSHIPS.md` | One line per relationship between items and records | search by ID |
| `REFERENCE.md` | Web addresses, people's details and other things to look up, not act on | on demand |
| `ASK-AGENT.md` | The agent queue: requests the user left for you from the UI ("Ask agent") | when running `discern-ask-agent` |
| `ASK-AGENT-LOG.md` | Append-only record of agent requests you have actioned | append only; read when asked |
| `SOURCES.md` | Settings shared by source skills (`## defaults`: time zone, priority people) and each source's state: watermark, filters, last run | by source skills; `timezone` whenever a time is written |
| `IGNORED.md` | Source keys never to be proposed again: ignored by a source skill or deleted by the user, and the changes the user said No to | by source skills |
| `DISMISSED.md` | Source keys of proposals the user dismissed, kept only until their source can no longer read the message again | by source skills, through `discern match` |
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
| `manifest.webmanifest` | What a browser needs to install the served UI as an app | never |
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
  - description: what the item is
    further lines of it, indented 4 spaces
  - link: [label](https://…)
  - ref: scheme|key   for example mail|normalised subject, teams|chat|messageId, cal|date|subject
  - comment: {added-datetime: YYYY-MM-DD HH:MM; author: email; acknowledged: no}
    the Comment's text, indented 4 spaces
  - [ ] sub-task
```

- The sub-lines come in that order: `src`, the description, `link`, `ref`, the Comments oldest first, then sub-tasks.
- `ty`: Task, Meeting, Process, Document or FYI.
- `who`: the person the item is with or waiting on. Must match a name in `PEOPLE.md` exactly; if no record matches, leave `who` out and name the person in the description.
- `urg`: today, week, soon, later or fyi. `p`: 1 high, 2 medium, 3 low.
- `due`: `YYYY-MM-DD`, or `YYYY-MM-DD HH:MM` when a time is known. Every `ty:Meeting` with a known date and time must carry the time.
- `st`: optional. `Waiting` means the user is waiting on someone else; `In progress` means started.
- `dep`: optional, comma-separated IDs of this item's **dependencies**: the items that must be done before this one can start. The reverse, the items that depend on this one, is worked out by the UI and never stored. A dependency that is done or gone counts as resolved; leave the tag in place unless asked.
- `prj`: optional, comma-separated `PRJ-####` IDs. `tg`: optional, comma-separated free-text tags; the tag list is whatever the data uses.
- `asg`: when the item reached the user (message timestamp; `12:00` if only the date is known). For an item a skill derives rather than receives, such as a prep item for a meeting, the time it was derived. Set it on every item a source skill creates.
- `ref`: the item's **source key**, a hidden key that ties it to the source thread, message or event it came from, so the same thing is never proposed twice: a scheme, then keys joined by `|`. The UI never shows or edits it, and renaming the item does not affect it. An item may carry several; a meeting with a date also carries a `cal|date|subject` source key so every source recognises it. A source key ending in `|*` stands for a whole chat or thread: on an item it means "related", never "already seen" (the older bare form `teams|chat-prefix` means the same). `SOURCE-SKILLS.md` lists the schemes and how they match.
- `note:` and `my:` lines are retired: the Description and Comments replaced them. Never write one; `discern check` warns about any left.
- `top:` is retired. The UI still reads it on old items; never write it.
- The user can merge a duplicate item into the item it duplicates, in the UI. Meetings never merge. The survivor keeps its ID and gains the duplicate's fields, Description, Comments, source keys and the rest; every reference to the duplicate (`RELATIONSHIPS.md`, `dep:`, the agent queue and its log, `rel|` lines in `IGNORED.md`) is made to the survivor, and the duplicate's ID is never used again. The survivor gets a Comment from `user`, "Merged T-#### into this.", so an ID you can't find may turn up by searching for it.
- Completing an item means moving it to `DONE.md` as `[x]` with `done:YYYY-MM-DD`. The UI does this itself; do it only when asked.

## Descriptions and Comments

Every item and record has at most one Description and any number of Comments.

- **The Description** says what the item or record is. Whoever creates it writes it: you, a source skill or the user. After that only the user changes it, or you when the user asks you to. It is one `  - description:` sub-line, its further lines indented 4 spaces; a blank line in it is a line of just those 4 spaces.
- **A Comment** is something added later: news, an answer, a decision. Its line holds only its fields, in braces, and its text follows on lines indented 4 spaces, as in the Description:
  - `added-datetime`: when it was added, local time in `timezone`. Comments the Migration made from old notes have none: they come first, as older than any dated one.
  - `author`: `user` for the user; the skill's word for a source skill (`email`, `calendar`, `teams`); `agent` for you, working an agent request or something the user asked you in a conversation.
  - `acknowledged: no`, only on a **Comment to acknowledge** (below).
  - `changed`, `from` and `to`, only on a **field change** (below): the field as this file names it, its value before and its value after. `from` is empty when the field had no value, and `to` when it was cleared.
  - `suggests: done`, only on a Comment to acknowledge saying an item is finished.

  New Comments go after the others, so they stay oldest first. Add one without asking whenever new information turns up, with `discern comment <id> --author <word> "<text>"` (`node tools/discern.mjs` from the app folder), which stamps the time and puts it in place. Never change or delete a Comment, the user's or anyone else's: the user can edit their own and delete any, in the UI.
- **A Comment to acknowledge** brings news from someone else that the user should see: a reply received, a Meeting moved or cancelled, new information about an item. `discern comment` with `--to-acknowledge` writes `acknowledged: no`, and the UI's Inbox shows the Comment until the user acknowledges it, which deletes the field. A Comment recording something the user did, such as a reply they sent, needs no acknowledging.
- **A field change** is news that changes a field: a new Due date or status, an item handed to someone else, a person's new job title. A source skill makes the change itself and tells the user with a Comment to acknowledge, through `discern change <id> --author <word> --field <field> --to <value> "<why>"`, which also adds a person's `hist:` line. It changes only an item's `due`, `st` (`Waiting`, `In progress`, or cleared) and `who`, and a person's `title`, `co`, `dept` and `mgr`. The rest (`urg`, `p`, `prj`, `tg`, `dep`, `ty`) are the user's own judgement, and closing an item is always the user's: news that one is finished is `discern comment <id> --to-acknowledge --suggests done "<text>"`. The newest news wins, even over a value the user set, and the same change is applied once. In the Inbox the user can Undo the latest change to a field, which puts back the value from before its first unacknowledged change, or Mark done an item that suggests it. A Meeting the calendar mirrors has no Undo: the calendar is its record.

  ```
    - comment: {added-datetime: 2026-10-25 09:14; author: email; acknowledged: no; changed: due; from: 2026-10-30; to: 2026-11-06}
      Jo says the 8D report slips a week.
  ```

## Projects and systems (PROJECTS.md, SYSTEMS.md)

```
- Title {id:PRJ-0001; type:Project|Workstream|Pod; parent:PRJ-0000; st:Active|On hold|Done}
  - description: what the project is
  - link: [label](https://…)
  - comment: {added-datetime: YYYY-MM-DD HH:MM; author: agent}
    the Comment's text
- Name {id:SYS-0001; type:Platform|Application|Instrument|…; owner:Person Name; st:Live; part-of:SYS-0000}
  - description: what the system is
  - link: [label](https://…)
```

- Optional `## Group` headings.
- News about a system goes on the system in `SYSTEMS.md`, as a Comment, not on an item.
- When a project's Description passes about ten lines, move it to `projects/<name>.md` and leave a `link:` to it on the project.

## People (PEOPLE.md)

```
## Group heading
- Full Name {id:P-0001; co:Company or business unit; dept:Department; title:Job title; mgr:Manager Name; ext:Y; st:Left; chk:YYYY-MM-DD; em:name@example.com; handle:staff-id}
  - description: who they are
  - hist: 2026-10-06 | Job title: old → new
  - comment: {added-datetime: YYYY-MM-DD HH:MM; author: agent}
    the Comment's text
```

- `P-0001` is the user. Never give it to anyone else, and never add a record for the user under another ID.
- The name must match `who:` on items, `owner:` on systems and `mgr:` on people. The UI never renames people; if you rename someone, update every one of those references in the same piece of work.
- `id` (`P-####`) never changes, even when the name is corrected. Use it when referring to a person in chat.
- Blank `co`, `dept`, `title` or `mgr` counts as missing and shows on the UI's People page. `chk` is the date the record was last checked; set it when you change a field.
- `ext:Y` marks a person outside the user's organisation. `st:Left` hides someone who has left.
- `em:` lists the person's email addresses, comma-separated; `handle:` lists other names or IDs they are addressed or mentioned by. Source skills use them to recognise senders, and the user's own record to recognise the user.
- When a field changes, add a `hist:` line: `- hist: YYYY-MM-DD | Field: old → new`. `hist:` lines are the record's change history, kept apart from its Comments.

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

## Changes in the inbox (INBOX.md)

Below the new items, `INBOX.md` may hold a `## Changes` heading: proposed changes to records, one line each, with the source skill's reason on a `- why:` sub-line. Field names follow `SOURCE-SKILLS.md`; `source` is the source's block in `SOURCES.md` and `received-datetime` is when the message reached it, in local time (`event-date: YYYY-MM-DD` for a horizon source). Nothing below the heading is an item.

```
## Changes
- Relate T-0007 and T-0032 {kind: related; source: outlook-mail; received-datetime: 2026-10-22 09:14}
  - why: Both chase the SCAR-031 8D report.
- New person Jo Bloggs {email: jo@acme.com; company: Acme; title: Buyer; items: T-0050, T-0051; source: outlook-mail; received-datetime: 2026-10-22 09:14}
  - why: Signs the mail as buyer at Acme.
- Add email jo.b@acme.com to Jo Bloggs (P-0012) {source: outlook-mail; received-datetime: 2026-10-22 09:14}
  - why: Writes from a second address.
- Make Jo Bloggs (P-0012) a Priority person {source: teams; received-datetime: 2026-10-22 09:14}
  - why: Sent four actionable messages this week.
```

The user answers each in the UI, Yes or No, and the UI removes the line:

- **Relationship**: Yes writes the line to `RELATIONSHIPS.md`, with the kind its two ends allow. While either end is a new item still in the inbox, the question is asked on that item, and dismissing the item drops it.
- **New person**: Add makes the record (a new `P-####`, `em:`, `co:` and `title:` as proposed) and sets `who` on the listed items that have none; Add as Priority person also adds the ID to `priority_people`. Either can also add an open Task to set up an introduction meeting, related to those items.
- **New email**: Yes adds the address to the person's `em:`, with a `hist:` line.
- **Priority person**: Yes adds the ID to `priority_people` in `SOURCES.md`. Only additions are proposed, never removals, and never someone who is one already.
- **No** logs the change in `IGNORED.md` (see below), and the helper never proposes it again; a No to a Priority person only pauses them, for 28 days from the date it logs.

Source skills write these lines only through `discern propose`; never edit them by hand.

## Agent queue (ASK-AGENT.md)

The user leaves agent requests for you from the UI ("Ask agent"). They wait in the agent queue, one line each:

```
- T-0025 | 2026-10-08 18:02 | the request
```

Line breaks inside a request are written as ` ⏎ `. The ID is the item or record the request is about. To work through the queue (this is what `discern-ask-agent` does):

1. Read `ASK-AGENT.md`. Take the requests oldest first.
2. For each request, find the item or record by its ID and do what it asks, within the data folder: update a record, add sub-tasks, add a URL or a relationship, answer a question as a Comment (`discern comment <id> --author agent "<answer>"`), or write a draft. Change a Description only when the request asks for that.
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
2. Each thing it finds is a candidate, which the skill assesses. A candidate whose source key already appears in `TASKS.md`, `INBOX.md`, `DONE.md`, `IGNORED.md` or `DISMISSED.md` is already tracked: it is skipped, becomes a Comment on the existing item when it brings news that changes no field, or becomes a field change the skill makes itself, with a Comment for the user to acknowledge (see "Descriptions and Comments").
3. The rest are ignored as noise, or written to `INBOX.md` as proposals for new items, with new IDs (shared counter), `src:`, `ref:`, `asg:` and `source:`, the name of the source's block in `SOURCES.md`. Relationships, new people, new email addresses and Priority people the run found go under `## Changes` in `INBOX.md` too (see "Changes in the inbox"). Then the cursor moves past the last window fully processed. A run reads at most `page_cap` pages a pass, so after a gap a stream source takes several runs to catch up: its report ends by saying whether it is caught up, and a refresh runs it again while it isn't. Meetings come from the calendar: a horizon source writes each Meeting in its window straight into `TASKS.md` as an open `ty:Meeting` item and keeps it in step with the calendar, but never marks one done; the mail skill leaves invitations to it.
4. The user clarifies each proposal in the UI's inbox. Accept moves the item to `TASKS.md`. Already handled accepts it and marks it done at once, so it goes to `DONE.md`. Dismiss, as Not actionable or Not mine, remembers only that message, in `DISMISSED.md`: later messages on the same thread can be proposed again. Dismiss as Duplicate merges the proposal into the item it duplicates (see "Item format"), which takes its source keys. `discern commit` removes the line once the source can no longer read the message again. A change is answered Yes, which makes it, or No, which is for good, except for a Priority person. A field change waits under New comments until the user acknowledges it or undoes it.

`SOURCES.md` starts with `## defaults`, then one block per source; each skill adds keys of its own:

```
## defaults
- timezone: Europe/London
- priority_people: P-0002, P-0007
- personal_domains: gmail.com, outlook.com
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

`IGNORED.md` lines are `ref | YYYY-MM-DD | reason`. Parse them from the right, because a source key may contain ` | `. A No to a proposed change is kept as `rel|<id>|<id>` for a Relationship, matching the pair in either order and whatever its kind, `person|<address>` for a new person or email address, or `priority|<P-id>` for a Priority person, which pauses that person for 28 days from its date.

`DISMISSED.md` lines follow the field names in `SOURCE-SKILLS.md`, with the source key as the line's text and the braces parsed from the final ` {`:

```
- mail|Toy fair preview {source: outlook-mail; received-datetime: 2026-10-22 09:14; dismissed-date: 2026-10-23; reason: not actionable}
```

`source` is the name of the source's block in `SOURCES.md`, and times are local, in `timezone`. A dated `cal` source key has `event-date: YYYY-MM-DD` in place of `received-datetime`. The UI writes these lines and the helper removes them: a stream source's once its `watermark` less `overlap` is past the message, a horizon source's once the event's date is before today. A line with no `source` waits for every stream source. Never edit them by hand.

## Changing the Format

The Format is the way a data folder is written. Each folder records its Format version in `DISCERNY.md`, and the app refuses a folder in any other Format. So a change to the Format may need a Migration, which `discern upgrade` runs to bring older folders up to date.

- **A change needs a Migration** if it rewrites data already in folders, if an older app would misread what it writes, or if it adds a file or setting that must be there.
- **A change needs none** if it adds an optional field or file that the app treats as absent when it's missing, and that an older app keeps intact. The parser keeps meta keys and sub-lines it doesn't know when it writes an Item back. New `SOURCES.md` keys that a skill adds follow the same rule.

The Format is defined in these places, and a change to any of them is a change to the Format:

- the format sections of this file, from "Item format" to "Sources, runs and refresh";
- the `//<core>` block in `discerny.html`, which holds the parser;
- the starter folder, `new_discerny_repo/`;
- `SOURCE-SKILLS.md`, and the `SOURCES.md` keys a skill adds;
- the helper's writers in `tools/discern.mjs`.

`migrations/README.md` says how to write a Migration.

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
