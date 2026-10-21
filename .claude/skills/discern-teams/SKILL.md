---
name: discern-teams
description: Captures Teams messages that mention or are addressed to the user, files shared with them, their own commitments and unanswered asks, and posts in watched channels into the Discerny inbox as proposals for the user to clarify. Use when asked to check or sync Teams or chats for Discerny, or as part of a Discerny refresh.
---

# discern-teams

## Start

Read `SOURCE-SKILLS.md` in the Discerny app folder and follow its loop; this file adds only what is specific to Teams. `AGENTS.md` is normally in context already; read it if it isn't, and find the data folder as its "Start here" says. With no data folder connected, ask the user which folder to use. If the Microsoft 365 connector's `chat_message_search` tool is missing and the block has no `fixture:`, say the connector isn't connected and stop with every file untouched.

## Tools

Microsoft 365 connector: `chat_message_search`, `teams_list_channel_messages` and `teams_list_channels`, and the host's MCP resource reader on a result's `uri` for full text.

## Connector behaviour (verified 2026-10-06)

- `chat_message_search` with `query: "*"` returns every message in every 1:1, group chat, meeting chat and channel the user is in: hundreds a week. Use the targeted passes below.
- Results come newest first, each with `id`, `chatId`, `from.displayName`, `from.email`, `summary` (about 250 characters, ending in "..." when cut), `createdDateTime`, `webUrl` and `uri`. Channel results add `channelUri` (it holds the team ID) and `subject`.
- Keep `from:`, `to:` and dates out of `query`; use the parameters for them.
- `teams_list_teams` is blocked (missing `Team.ReadBasic.All`). Take a team ID from a channel result's `channelUri` (percent-decode its teamId segment); `teams_list_channels` accepts it.
- Chat IDs end `@unq.gbl.spaces` for 1:1 chats, `@thread.v2` for group and meeting chats, and `@thread.tacv2` for channels.
- Search indexing can lag; `overlap` covers it.

## Block

`## teams-chat`, a stream source: `watermark`, `overlap`, `mention_query` (optional), `mention_read_cap` (read budget for the mention filter, default 8), `scan_own_commitments`, `scan_sent_asks`, `waiting_min_age`, `waiting_max_age`, `waiting_checked_through`, `waiting_check_cap`, `watch_channels` (lines `teamId | channelId | label`), `candidate_channels`, `exclude_chat` (chat-ID prefixes), `exclude_text` (a regular expression), `chat_labels` (lines `label (chat prefix)`), `last_run`, `last_result`; optional `page_cap`, `split`, `gap` and `fixture`.

## Passes

For each of `windows`, run A to D1 together with `afterDateTime` and `beforeDateTime` set to the window, `limit: 25` unless stated.

- **A, mentions:** `query` = `mention_query`, or the state's `mention_terms` joined with `OR`.
- **B, priority people:** for each entry in the state's `priority_people`: `query: "*"`, `sender: <their address, else name>`, following pages as in the other passes.
- **C, files:** `query: "*"`, `hasAttachment: true`.
- **D1, commitments** (when `scan_own_commitments` is true): `sender: <the user's address>`, `query: "I'll" OR "I will" OR "will send" OR "let me"`.
- **D2, asks** (when `scan_sent_asks` is true), for each of `ask_windows`, oldest first, finishing each day before the next: `sender: <the user's address>`, `query: "can you" OR "could you" OR "please" OR "let me know" OR "when can" OR "by end of"`. Send them, and D1's results, to `discern match` with `pass: "ask"`, then keep concrete requests to someone else. Check replies against one shared pool rather than one search per ask: `query: "*"` with `afterDateTime` at the oldest ask's `createdDateTime`, up to 5 pages. An ask is answered when the pool holds a later message in the same `chatId` from someone else. Asks past `waiting_check_cap`, or older than the pool reached before it ran out of pages, are not yet checked.
- **E, watched channels:** for each `watch_channels` line, `teams_list_channel_messages(teamId, channelId, limit: 20)`. These come by latest activity with no date filter: follow `cursor` until a page holds only messages whose `lastModifiedDateTime` is before the state's `cutoff`. For each top-level message changed since `cutoff`, read its replies once (`parentMessageId`, `limit: 20`) and treat each reply as a message. `bodyPreview` is HTML of up to 1,000 characters, so strip the tags; read the full body (`bodyTruncated: true`) only for posts that may be worth a proposal. Drop the user's own posts and system events (`messageType` other than `message`, or no `from`).

Channels listed in `candidate_channels` aren't scanned. When posts in one of them keep turning up in pass A, propose watching it.

## Filters

- **Mention filter** (pass A only), in order: drop messages from the user's addresses. In group chats, meeting chats and channels, keep a message only if its text has the user's first name or a handle (any case). When a summary ends in "..." and lacks them, read the full text once, oldest message first, within `mention_read_cap`; once the budget is spent, capture the rest from their summaries and count them under "Not yet checked". Keep every inbound 1:1 message.
- After merging all passes by message `id`: drop pure acknowledgements ("thanks", "ok", an emoji), chats matching `exclude_chat`, text matching `exclude_text`, and the user's own messages outside D1 and D2.
- A personal, religious or social chat is out of scope. When the whole chat is personal, `discern ignore` its whole-chat source key `teams|<chat20>|*` with `"container": true` and the reason "personal". Don't log single noise messages.

## Source keys

`teams` scheme. A source key is `teams|<chat20>|<message id>`, where chat20 is the chat ID without its `19:` prefix, cut to 20 characters; `match` returns it, so copy source keys from there. Each `discern match` candidate: `{"key": <id>, "scheme": "teams", "pass": <"ask" for D1 and D2, else "inbound">, "chat": <chatId>, "message": <id>, "sender": <from.email>, "sender_name": <from.displayName>, "when": <createdDateTime>}`; for channel posts `chat` is the channel ID. Add `subject` and `meeting_date` for a meeting with a known date. On a `related` outcome, judge whether the message is about the same work as that item: if so, propose an update; if not, assess it as new.

## Assess cues

- Worth a proposal: direct asks to the user ("could you", "please", a question), files they are expected to read or use (pass C, or a URL in the text), scheduling asks, due dates, decisions needing their input, and posts in watched channels that ask the team for something.
- Information-only messages from priority people that teach something lasting (a process, a system, who owns what): `ty:FYI` or `ty:Process`, `urg:fyi` or `later`.
- Several messages in one chat on one topic make one item, with every source key.
- Someone not in `priority_people` who sent two or more actionable messages this run: propose adding them, under "People and settings proposed".

## Item specifics

- `src`: `Teams <label> — <sender>, <d Mon>`. The label comes from `chat_labels` when the chat matches, else the channel's name or subject, else "1:1". For asks: `Teams <label> — <user> asked <person>, <d Mon>`.
- `links`: `[Teams message](<webUrl>)`, plus any document link in the text.
- `received`: `createdDateTime`.
- `who` on an ask: the person asked, from the text, else from someone else's message in the same chat this run. Still unclear: leave `who` out and note "addressee unclear".

## Known limits

- Unwatched channels are seen only through mentions, attachments or priority people.
- An ask counts as answered only when the reply is in the pool, so very old asks can stay not yet checked.
- Meeting transcripts aren't available here; discern-outlook-calendar has them for meetings the user organised.

## Fixtures

With `fixture: <folder>` in the block, read instead of calling the connector: `mentions.json`, `priority.json`, `files.json`, `commitments.json`, `asks.json`, `pool.json` and `channels.json` (each holding that pass's results for every window, or ask window, of this run), and `resources.json` (full text, keyed by `uri`). `scenario.json` holds only the run time, which `discern state` uses; pass `--now <run_start>` to every later `discern` command.
