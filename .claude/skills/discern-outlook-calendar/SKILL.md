---
name: discern-outlook-calendar
description: Mirrors every meeting in the coming days of the Outlook calendar into Discerny as an open Meeting item, keeping each in step when it moves or is cancelled, proposes prep items and replies to unanswered invites into the Discerny inbox, reports meetings that overlap, and can capture action items from transcripts. Use when asked to check meetings or the calendar for Discerny, or as part of a Discerny refresh.
---

# discern-outlook-calendar

## Start

Read `SOURCE-SKILLS.md` in the Discerny app folder and follow its loop; this file adds only what is specific to the Outlook calendar. `AGENTS.md` is normally in context already; read it if it isn't, and find the data folder as its "Start here" says. With no data folder connected, ask the user which folder to use. If the Microsoft 365 connector's `outlook_calendar_search` tool is missing and the block has no `fixture:`, say the connector isn't connected and stop with every file untouched. Never accept, decline, forward or change an event.

## Tools

Microsoft 365 connector: `outlook_calendar_search`, and the host's MCP resource reader on an event's `uri` (attendees with their `responseStatus`, the body, `meetingTranscriptUrl`) and on a transcript URL.

## Connector behaviour (verified 2026-10-06)

- `outlook_calendar_search(query: "*", afterDateTime, beforeDateTime, order: "oldest", limit: 10, offset)`; follow `nextOffset`. Keep the window and limit this small: an unbounded pull was too large.
- Results are metadata only: `id`, `subject`, `organizer`, `attendees` (addresses only), `start` and `end` as `{dateTime, timeZone}`, `summary` (about 250 characters), `showAs`, `isAllDay`, `isCancelled`, `isOrganizer`, `importance`, `webLink` and `uri`. They don't include the user's response; read the event for that.
- `start` and `end` are wall-clock times in the named zone, which is often UTC. Pass the pair to `discern local` or `discern meetings` as it is; never treat it as UTC yourself.
- Transcripts reach only the organiser, through the event's `meetingTranscriptUrl`. An empty transcripts array means none was recorded. AI recaps and recordings aren't reachable.

## Block

`## outlook-calendar`, a horizon source: `lookahead` (default `P7D`), `exclude-subject`, `surface-only-if-tracked`, `prep-signals` (a regular expression), `invite-check-cap` (the read budget for every event and transcript read, default 6), `transcripts` (`off`, the default, or `organizer-only`), `last-run` and `last-result`; optional `page-cap` and `fixture`.

## Passes

Fetch the state's `window`, up to `page-cap` pages. First drop events matching `exclude-subject`, all-day events, events where the user is the only attendee (focus time), and personal, religious or social events (out of scope). A `showAs: free` event that isn't cancelled may be a Meeting the user declined and kept on the calendar: send these to `discern match` with `"free": true` and follow its action. It drops the untracked ones; read each tracked one once, within the budget. Only one the user declined goes on, to pass M with `"free": true, "declined": true`. Every other free event is dropped from every pass, including pass A and B, whatever `prep-signals` says, and whether or not it is tracked. What is left are the user's Meetings, whoever organised them.

- **M, Meetings.** Send every Meeting to `discern meetings` (Source keys). It puts each one not yet tracked straight into `TASKS.md` as an open Meeting item, without a proposal, and keeps tracked ones in step: a moved Meeting gets its new Due date and title, with a field change Comment saying where it moved from (`changed: due-date` or `due-time`), and a cancelled or declined one stays open, retitled "Cancelled: …", with the Comment "Found cancelled.". Both Comments wait in the Inbox for the user to acknowledge. It never closes a Meeting; only the user marks one done. Its `added`, `moved` and `cancelled` lists go in the report's Meetings line.
- **A, prep needed.** Only the Meetings in pass M's `added` list: a Meeting tracked before this run had its prep decided then, so it gets no prep item now, whatever its subject. One of these needs prep when its subject matches `prep-signals`, the user organises it (they need an agenda), it has attachments, or its summary asks the user to review, bring or prepare something. It also needs prep when a priority person organises it and the summary has an agenda, a pre-read or a document URL. When the summary can't decide, read the event (it counts against the budget). If that read shows no prep is needed, `discern ignore` its `prep` source key with the reason "no prep needed". Otherwise an event with no signal is dropped silently, including one read only for pass B. Match prep candidates with `suffix: "prep"`.
- **B, unanswered invites.** Decide pass A first. These are events starting within 3 days that the user doesn't organise and that are tentative, high importance or from a priority person. Read each one, within the budget: a `responseStatus` of `none` for the user means unanswered. When the event has a prep draft from this run, add "No response recorded." to that draft's description; when it has a tracked prep or invite item, add the Comment "No response recorded." to it (not to acknowledge: it is about the user), unless its description or a Comment already says so. Otherwise match with `suffix: "invite"` and draft an invite item. Events left unread are not yet checked.
- **Overlaps.** Among Meetings that are `busy` or `tentative`, report up to 5 pairs that overlap.
- **T, transcripts**, only when `transcripts` is `organizer-only`. Search the state's `lookback` the same way and keep ended events the user organised. Read each event, then its `meetingTranscriptUrl`. Each explicit action item with an owner becomes an item, matched with suffix `transcript-<n>`. The user's own item is a task; someone else's is a waiting-for item, "Waiting: <what> from <person>" with `status: waiting` and `who` that person, its description saying "Agreed at <meeting> on <d Mon>.". Give `due-date` only when a date is stated, and set urgency by the shared policy. Never copy transcript text into a file.

Prep, invite and transcript items are proposals, each proposed as related to its Meeting item with `discern propose`, once `discern add` has given it its ID.

## Source keys

`cal` scheme. `discern meetings` takes `[{"subject", "start": <the start pair>, "event-id", "organizer": <address>, "organizer-name", "web-link"}]`, plus `"cancelled": true` for an event with `isCancelled: true` or a "Canceled:" or "Cancelled:" subject, `"declined": true` for a tracked Meeting, busy or free, whose read shows the user's `responseStatus` as declined, and `"free": true` for a free event. It writes nothing for a free event that isn't declined or cancelled, and lists it under `dropped`. It matches on the `cal` and `calid` source keys, so running it again changes nothing, and it recognises a Meeting another source already tracks.

Each `discern match` candidate: `{"key": <id>, "scheme": "cal", "subject": ..., "start": <the start pair>}`, plus the `suffix` its pass names; a free event is matched with its `event-id`, no suffix and `"free": true`, so a moved one is still found. Write the `refs` that `match` returns as the draft's `source-keys` (a free event returns none).

## Assess cues

- Every proposal here is derived: pass `derived: true`.
- Prep and invite items: `due-date` and `due-time` are the meeting's local start; urgency is `today` if the meeting is today, `this week` within 7 days, else `soon`.

## Item specifics

- **Meeting:** written by `discern meetings`: the event's subject as title, `type: meeting`, `who` the organiser (left out when the user organises or isn't in `PEOPLE.md`), `priority: medium`, `due-date` and `due-time` its local start, `origin: Calendar "<subject>" organised by <organiser>` and `[Outlook event](<webLink>)`.
- **Prep:** title "Prepare for <meeting> (<d Mon HH:MM>)", `type: task`, `who` the organiser (left out when the user organises), `priority: medium` (`high` when a priority person asks for something specific). `origin`: `Calendar "<subject>" organised by <organiser>, <d Mon HH:MM>–<HH:MM>`. The description says why prep is needed; `links` are `[Outlook event](<webLink>)` and any agenda or pre-read link.
- **Invite:** title "Respond to invite: <meeting> (<d Mon HH:MM>)", `type: task`, `priority: low`, `origin: Calendar invite from <organiser>`, and the description "No response recorded; starts <d Mon HH:MM>.".
- **Comments** are by `calendar`: `discern comment <id> --author calendar`.
- **Transcript:** title is the action item, or the waiting-for title for someone else's. `origin: Transcript of "<subject>" (<d Mon>)`.

## Known limits

Only meetings within `lookahead` are seen; later ones appear as they come closer. A meeting the user declined that Outlook has taken off their calendar isn't seen, so its Meeting item stays as it was. Transcripts exist only for meetings the user organised.

## Fixtures

With `fixture: <folder>` in the block, read instead of calling the connector: `events.json` (results for the window), `lookback.json` (results for the transcript window) and `resources.json` (events and transcripts, keyed by `uri` or URL; an event missing from it can't be read). `scenario.json` holds only the run time, which `discern state` uses; pass `--now <run_start>` to every later `discern` command.
