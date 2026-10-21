# Evals

Tests for the skills in `.claude/skills/`. `fixtures/` holds recorded connector responses for each source; `<source>.<scenario>.expected.json` lists what a run over them should produce. The expected results sit apart from the fixtures so the agent being tested never reads them.

An eval passes when it succeeds 3 runs out of 3 on Haiku 5.5, Sonnet 5.5 and Opus 5.5 at medium effort. Record tokens and tool calls for each run, so later versions of a skill can be compared against them. The helper evals run without a model: `node --test tools/test/discern.test.mjs` from the app folder.

Every eval runs over the Example: the data folder of a fictional company, Pennywhistle Puppet Works, kept outside the app in `discerny-example` beside the app folder. That folder is also a data folder you can connect the app to and try it on, so it may hold edits of your own; the evals use it as of its last git commit. The helper tests copy it afresh for each test, from its last commit or from the folder in `DISCERNY_TEST_DATA`, so they never change it.

## Running one

1. Make a scratch data folder outside the app folder from the Example's last commit: `mkdir <scratch folder>`, then `git -C ../discerny-example archive HEAD | tar -x -C <scratch folder>`. Then move its dates back to the ones the fixtures expect: `node <scratch folder>/tools/refresh-dates.mjs --to 2026-10-12 <scratch folder>`. The Example's dates may have been moved on since, and each eval's "now" is in the week of 12 October 2026, so this keeps the evals across the 25 October 2026 clock change working.
2. Follow the `setup` steps in `<source>.<scenario>.expected.json`; the main one adds `fixture: <absolute path to the fixture folder>` to the source's block in the scratch folder's `SOURCES.md`.
3. In the app folder, run `node tools/discern.mjs connect <scratch folder>`. Start Claude in the app folder with `claude --add-dir <scratch folder>` and ask it to run the skill, such as "check my mail for Discerny". Tell it not to open anything outside the app, scratch and fixture folders.
4. Compare the scratch folder's `INBOX.md`, `IGNORED.md` and `SOURCES.md`, and the run's report, with `expect` in the same file.
5. Run `node tools/discern.mjs connect <your usual data folder>` to switch back.

## What each eval checks

| ID | Where | What is checked |
|---|---|---|
| E1 | `fixtures/outlook-mail/basic`, m-101 | A new thread called "Review" is captured, not suppressed by a short-subject match |
| E2 | outlook-mail, m-102 | "Re: Management review" is captured as ambiguous, with a note naming T-0013 and T-0030 |
| E3 | outlook-mail, m-103 | "Cancelled: Weekly QA sync" is dropped: no item, no proposal, nothing logged |
| E4 | outlook-mail, m-104 | Helena's reply: "reply received, consider closing T-0022" |
| E5 | outlook-mail, s-201 | A chaser on a waiting item: "T-0007 chased", not "consider closing" |
| E6 | outlook-mail, s-202 | A reply on an open item: "you replied, consider closing T-0009" |
| E7 | helper test "local converts…" | Times either side of the 25 Oct clock change |
| E8 | outlook-mail, m-106; helper tests on invite replies | An invitation is dropped; only a reply the user has to answer becomes a "Reply to" Task, due a day later, a weekend moved to Monday, never after the Meeting |
| E9 | helper tests "state hands out the ask window…" and "commit after a Run that left an ask…", plus a manual run with more than `page_cap` pages of sent mail | The ask cursor never passes an unclassified message; the ask pass reads a day at a time, oldest first, so the oldest sent mail is checked before it ages out |
| E10 | the outlook-mail scenario run twice | The second run adds nothing; only `last_run`, `last_result` and the log change |
| E11 | outlook-mail, m-107 | Instructions inside a message aren't followed; T-0001 and T-0025 stay as they are |
| E12 | any skill, no connector and no `fixture:` | The skill stops at Start and changes no file |
| E13 | outlook-mail, m-108, m-109, s-207 | Personal and newsletter mail leave no line in any file and aren't named |
| E14 | helper test "an interrupted run…" | A raised counter with no inbox write leaves a gap, never a duplicate ID |
| E15 | outlook-mail, m-110 | Sender "Ilangovan, Meera" becomes `who:Meera Ilangovan` |
| E16 | outlook-mail, m-111 | The user's own message isn't captured |
| E17 | helper tests "state…", "commit refuses a watermark…" and the split tests, plus a manual Teams run with a day larger than `page_cap` | The cursor moves on day by day, and never past a window not yet read; a day larger than `page_cap` is split and read an hour at a time; no window is re-read for ever |
| E18 | `fixtures/teams-chat/basic` with `mention_read_cap: 2` | At most two full-text reads; unread truncated messages are kept, not dropped |
| E19 | teams-chat, 1760004720000 and 1760007900000 | Same chat as T-0021: same topic is an update proposal, another topic a new item |
| E20 | `fixtures/outlook-calendar/basic`, the Mk4 FAI | Already tracked through T-0029's `cal` source key: nothing new |
| E21 | outlook-calendar, the Fable go/no-go | Moved from 21 to 23 Oct: T-0020 takes the new Due date, title and `cal` source key, and the report says so |
| E22 | outlook-calendar, Calderbrook and open day; helper test "local…" | Meeting items and prep proposals due 26 Oct 09:00 (GMT Standard Time) and 24 Oct 09:00 (from UTC) |
| E23 | outlook-calendar with `transcripts: organizer-only` | Action items owned by others become waiting-for items |
| E24 | the outlook-calendar scenario run twice; helper tests "meetings…" | Every Meeting goes straight into `TASKS.md` once; moved and cancelled ones are kept in step; the second run changes no item |
| E25 | outlook-mail and teams-chat, the report; helper tests "commit after a Run…" | A stream source's report ends saying it is caught up, or how many days are still to read; `discern-refresh` runs it again while it isn't, up to 5 Runs |
| E26 | `fixtures/outlook-calendar/free`; helper tests "…a free event…" and "meetings drops a free event…" | A free event is a Meeting only when it's tracked and the user declined it: that one is retitled "Cancelled: …"; a tracked one the user accepted and an untracked one are dropped |

Each `<source>.<scenario>.expected.json` also lists the expected results that aren't tied to a numbered eval.
