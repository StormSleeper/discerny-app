---
name: discern-outlook-mail
description: Captures new Outlook mail, and sent mail still waiting for a reply or recording a commitment, into the Discerny inbox as proposals for the user to clarify. Use when asked to check or sync mail or Outlook for Discerny, or as part of a Discerny refresh.
---

# discern-outlook-mail

## Start

Read `SOURCE-SKILLS.md` in the Discerny app folder and follow its loop; this file adds only what is specific to Outlook mail. `AGENTS.md` is normally in context already; read it if it isn't, and find the data folder as its "Start here" says. With no data folder connected, ask the user which folder to use. If the Microsoft 365 connector's `outlook_email_search` tool is missing and the block has no `fixture:`, say the connector isn't connected and stop with every file untouched.

## Tools

Microsoft 365 connector: `outlook_email_search` for message metadata, and the host's MCP resource reader (`read_resource` or its equivalent) on a result's `uri` for the body.

## Connector behaviour (verified 2026-10-06)

- Results are metadata only, newest first, 25 to a page; follow `nextOffset`.
- Inbound mail: pass `afterDateTime`, `beforeDateTime`, `limit: 25` and `offset`, and leave `query`, `order` and `folderName` unset. If the connector rejects `beforeDateTime` without `folderName` (not yet verified), search from `cutoff` with `afterDateTime` alone, fetch every page, and say so in the report.
- Sent mail is reachable only with `folderName: "Sent Items"` plus dates. `sender` doesn't find the user's own mail, and neither `recipient` nor `query` combines with `folderName`. Sent Items results carry `recipients` (addresses) and `sentDateTime`.
- A reply check is `query: "\"<normalised subject>\""` with `afterDateTime` only.

## Block

`## outlook-mail`, a stream source: `watermark`, `overlap`, `exclude_subject` (regular expressions), `exclude_sender` (address fragments), `scan_sent_asks`, `waiting_min_age`, `waiting_max_age`, `waiting_checked_through`, `waiting_check_cap` (the read budget for sent mail), `last_run`, `last_result`; optional `page_cap`, `gap` and `fixture`.

## Passes

1. **Inbound**, for each of `windows`: `outlook_email_search(afterDateTime, beforeDateTime, limit: 25, offset)`.
2. **Sent**, when `scan_sent_asks` is true and `ask_window` exists: `outlook_email_search(folderName: "Sent Items", afterDateTime, beforeDateTime, limit: 25, offset)` over `ask_window`. Drop what Filters lists for sent mail, send the rest to `discern match` with `pass: "ask"`, and follow each action. Classify what is left oldest first, reading a body when the summary can't decide, up to `waiting_check_cap` reads:
   - an **ask**: the user asked someone to do, send, decide or answer something;
   - a **commitment**: the user promised something ("I'll send", "I will", "by Friday"). A reply doesn't fulfil it, so it needs no reply check;
   - neither: drop it.

   Check every ask for a reply; the checks are independent, so run them together. An ask is answered when a result was received after the sent time, isn't from the user, and has the same normalised subject. Drop answered asks.

## Filters

- Inbound: the block's exclude rules; anything `match` marks `from_user`; senders such as `no-reply@`; mail from `personal_domains` (out of scope). Other notices that ask nothing of the user are noise: `discern ignore` their `mail` source key with a reason, so they are logged and skipped on later runs.
- Sent: invitations the user sent (the summary is only a Teams join block), forwards with no comment, mail only to the user, the exclude rules, and mail only to `personal_domains` (out of scope).
- `match` handles calendar replies: Accepted and Tentative are dropped, and a decline or cancellation becomes a proposal only when it matches an item.

## Source keys

`mail` scheme. Each `discern match` candidate: `{"key": <id>, "scheme": "mail", "pass": "inbound" or "ask", "subject": ..., "sender": <from address>, "sender_name": <from name>, "when": <receivedDateTime or sentDateTime>}`; on the ask pass add `"recipient": <the first address in recipients>`. Add `"meeting_date": "YYYY-MM-DD"` (local, via `discern local`) for an invitation with a known date.

## Assess cues

- `importance: high` is always captured.
- The user only on Cc: FYI. Use the recipients when the result has them; otherwise read the body only if it decides.
- An invitation with a known date and time is `ty:Meeting` with `due` at its start. Anything else it asks for (bring, read, decide) goes in that item's note rather than in a second item. When `SOURCES.md` also has an `outlook-calendar` block, leave invitations to that skill unless the message asks for more than attending, such as a pre-read or a decision.
- Read a body only when the summary can't decide, once per message.

## Item specifics

- `src`: `Email "<subject>" from <sender name> (<d Mon>)`; for sent mail, `Email "<subject>" sent to <recipient addresses> (<d Mon>)`.
- `received`: `receivedDateTime`, or `sentDateTime` for sent mail.
- `who` on sent-mail items: the main recipient, which `match` returns from `recipient`.
- `links`: only a URL in the mail the user needs, such as a document or form.

## Known limits

Sent mail older than `waiting_max_age` is never checked for replies. Two threads with the same short subject share a source key; `match` reports the longer collisions as ambiguous.

## Fixtures

With `fixture: <folder>` in the block, read files instead of calling the connector: `inbound.json` (every inbound result for all the windows: take each window's by `receivedDateTime`), `sent.json` (Sent Items results in the ask window), `replies.json` (reply-check results keyed by normalised subject; a missing key means no reply) and `resources.json` (bodies, keyed by `uri`). `scenario.json` holds only the run time, which `discern state` uses; pass `--now <run_start>` to every later `discern` command.
