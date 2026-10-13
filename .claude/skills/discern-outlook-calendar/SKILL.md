---
name: discern-outlook-calendar
description: Proposes prep tasks and replies to unanswered invites for the coming days of the Outlook calendar into the Discerny inbox, reports tracked meetings that were cancelled or moved and meetings that overlap, and can capture action items from transcripts. Use when asked to check meetings or the calendar for Discerny, or as part of a Discerny refresh.
---

# discern-outlook-calendar

## Start

Read `SOURCE-SKILLS.md` in the Discerny app folder and follow its loop; this file adds only what is specific to the Outlook calendar. `AGENTS.md` is normally in context already; read it if it isn't, and find the data folder as its "Start here" says. With no data folder connected, ask the user which folder to use. If the Microsoft 365 connector's `outlook_calendar_search` tool is missing and the block has no `fixture:`, say the connector isn't connected and stop with every file untouched. Never accept, decline, forward or change an event.

## Tools

Microsoft 365 connector: `outlook_calendar_search`, and the host's MCP resource reader on an event's `uri` (attendees with their `responseStatus`, the body, `meetingTranscriptUrl`) and on a transcript URL.

## Connector behaviour (verified 2026-10-06)

- `outlook_calendar_search(query: "*", afterDateTime, beforeDateTime, order: "oldest", limit: 10, offset)`; follow `nextOffset`. Keep the window and limit this small: an unbounded pull was too large.
- Results are metadata only: `id`, `subject`, `organizer`, `attendees` (addresses only), `start` and `end` as `{dateTime, timeZone}`, `summary` (about 250 characters), `showAs`, `isAllDay`, `isCancelled`, `isOrganizer`, `importance`, `webLink` and `uri`. They don't include the user's response; read the event for that.
- `start` and `end` are wall-clock times in the named zone, which is often UTC. Pass the pair to `discern local` as it is; never treat it as UTC yourself.
- Transcripts reach only the organiser, through the event's `meetingTranscriptUrl`. An empty transcripts array means none was recorded. AI recaps and recordings aren't reachable.

## Block

`## outlook-calendar`, a horizon source: `lookahead`, `exclude_subject`, `surface_only_if_tracked`, `prep_signals` (a regular expression), `invite_check_cap` (the read budget for every event and transcript read, default 6), `transcripts` (`off`, the default, or `organizer-only`), `last_run` and `last_result`; optional `page_cap` and `fixture`.

## Passes

Fetch the state's `window`, up to `page_cap` pages. First drop events matching `exclude_subject`, all-day events, `showAs: free` events that aren't cancelled, events where the user is the only attendee (focus time), and personal, religious or social events (out of scope). Then send the rest to `discern match` and follow each action. A moved meeting gets the `discern ref` its action names; a cancelled tracked meeting goes in the report, never in a file.

- **A, prep needed.** A new event needs prep when its subject matches `prep_signals`, the user organises it (they need an agenda), it has attachments, or its summary asks the user to review, bring or prepare something. It also needs prep when a priority person organises it and the summary has an agenda, a pre-read or a document link. When the summary can't decide, read the event (it counts against the budget). If that read shows no prep is needed, `discern ignore` its ref with the reason "no prep needed". Otherwise an event with no signal is dropped silently, including one read only for pass B.
- **B, unanswered invites.** Decide pass A first. These are events starting within 3 days that the user doesn't organise and that are tentative, high importance or from a priority person. Read each one, within the budget: a `responseStatus` of `none` for the user means unanswered. When the event has a prep draft from this run, add "no response recorded" to that draft's note; when it has a tracked item, propose that note as an update. Otherwise match with `suffix: "invite"` and draft an invite item. Candidates left unread are not yet checked.
- **C, cancellations.** Events with `isCancelled: true`, or a "Canceled:" or "Cancelled:" subject, go to `match` with `cancelled: true`; only tracked ones are reported.
- **Overlaps.** Among events that passed the filters and are `busy` or `tentative`, report up to 5 pairs that overlap.
- **T, transcripts**, only when `transcripts` is `organizer-only`. Search the state's `lookback` the same way and keep ended events the user organised. Read each event, then its `meetingTranscriptUrl`. Each explicit action item with an owner becomes an item, matched with suffix `transcript-<n>`. The user's own item is a task; someone else's is a waiting-for item, "Waiting: <what> from <person>" with `st:Waiting` and `who` that person, noted "agreed at <meeting> on <d Mon>". Give `due` only when a date is stated, and set urgency by the shared policy. Never copy transcript text into a file.

## Refs

`cal` scheme. Each `discern match` item: `{"key": <id>, "scheme": "cal", "subject": ..., "start": <the start pair>, "event_id": <id>}`, plus `"cancelled": true` or a `suffix` where a pass says so. Write the `refs` that `match` returns: the `cal` ref and the event's `calid` ref.

## Clarify cues

- Every item here is derived: pass `derived: true`.
- Prep and invite items: `due` is the meeting's local start with its time; urgency is `today` if the meeting is today, `week` within 7 days, else `soon`.

## Item specifics

- **Prep:** title "Prepare for <meeting> (<d Mon HH:MM>)", `ty:Meeting`, `who` the organiser (left out when the user organises), `p:2` (`p:1` when a priority person asks for something specific). `src`: `Calendar "<subject>" organised by <organiser>, <d Mon HH:MM>–<HH:MM>`. The note says why prep is needed; links are `[Outlook event](<webLink>)` and any agenda or pre-read link.
- **Invite:** title "Respond to invite: <meeting> (<d Mon HH:MM>)", `ty:Meeting`, `p:3`, `src: Calendar invite from <organiser>`, and the note "no response recorded; starts <d Mon HH:MM>".
- **Transcript:** title is the action item, or the waiting-for title for someone else's. `src: Transcript of "<subject>" (<d Mon>)`.

## Known limits

Only meetings within `lookahead` are seen; later ones appear as they come closer. Transcripts exist only for meetings the user organised.

## Fixtures

With `fixture: <folder>` in the block, read instead of calling the connector: `events.json` (results for the window), `lookback.json` (results for the transcript window) and `resources.json` (events and transcripts, keyed by `uri` or URL; an event missing from it can't be read). `scenario.json` holds only the run time, which `discern state` uses; pass `--now <run_start>` to every later `discern` command.
