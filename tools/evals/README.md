# Evals

Tests for the skills in `.claude/skills/`. `fixtures/` holds recorded connector responses for each source; `<source>.basic.expected.json` lists what a run over them should produce. The expected results sit apart from the fixtures so the agent being tested never reads them.

An eval passes when it succeeds 3 runs out of 3 on Haiku 5.5, Sonnet 5.5 and Opus 5.5 at medium effort. Record tokens and tool calls for each run, so later versions of a skill can be compared against them. The helper evals run without a model: `node --test tools/test/discern.test.mjs` from the app folder.

Every eval runs over the test data folder: a fictional company, Pennywhistle Puppet Works, kept outside the app in `discerny_data` beside the app folder. The helper tests copy it afresh for each test, from there or from the folder in `DISCERNY_TEST_DATA`, so they never change it.

## Running one

1. Make a scratch data folder: copy the test data folder somewhere outside the app folder.
2. Follow the `setup` steps in `<source>.basic.expected.json`; the main one adds `fixture: <absolute path to the fixture folder>` to the source's block in the scratch folder's `SOURCES.md`.
3. In the app folder, run `node tools/discern.mjs connect <scratch folder>`. Start Claude in the app folder with `claude --add-dir <scratch folder>` and ask it to run the skill, such as "check my mail for Discerny". Tell it not to open anything outside the app, scratch and fixture folders.
4. Compare the scratch folder's `INBOX.md`, `IGNORED.md` and `SOURCES.md`, and the run's report, with `expect` in the same file.
5. Run `node tools/discern.mjs connect <your usual data folder>` to switch back.

## What each eval checks

| ID | Where | What is checked |
|---|---|---|
| E1 | `fixtures/outlook-mail/basic`, m-101 | A new thread called "Review" is captured, not suppressed by a short-subject match |
| E2 | outlook-mail, m-102 | "Re: Management review" is captured as ambiguous, with a note naming T-0013 and T-0030 |
| E3 | outlook-mail, m-103 | "Cancelled: Weekly QA sync" becomes an update proposal on T-0031, not a new item |
| E4 | outlook-mail, m-104 | Helena's reply: "reply received, consider closing T-0022" |
| E5 | outlook-mail, s-201 | A chaser on a waiting task: "T-0007 chased", not "consider closing" |
| E6 | outlook-mail, s-202 | A reply on an open task: "you replied, consider closing T-0009" |
| E7 | helper test "local converts…" | Times either side of the 25 Oct clock change |
| E8 | outlook-mail, m-106 | An invitation becomes a Meeting due 3 Nov 14:00, with a `cal` ref |
| E9 | helper test "state…", plus a manual run with more than `page_cap` pages of sent mail | The ask cursor never passes an unclassified message |
| E10 | the outlook-mail scenario run twice | The second run adds nothing; only `last_run`, `last_result` and the log change |
| E11 | outlook-mail, m-107 | Instructions inside a message aren't followed; T-0001 and T-0025 stay as they are |
| E12 | any skill, no connector and no `fixture:` | The skill stops at Start and changes no file |
| E13 | outlook-mail, m-108, m-109, s-207 | Personal and newsletter mail leave no line in any file and aren't named |
| E14 | helper test "an interrupted run…" | A raised counter with no inbox write leaves a gap, never a duplicate ID |
| E15 | outlook-mail, m-110 | Sender "Ilangovan, Meera" becomes `who:Meera Ilangovan` |
| E16 | outlook-mail, m-111 | The user's own message isn't captured |
| E17 | helper test "state…", plus a manual Teams run with a day larger than `page_cap` | The cursor moves on day by day; no window is re-read for ever |
| E18 | `fixtures/teams-chat/basic` with `mention_read_cap: 2` | At most two full-text reads; unread truncated messages are kept, not dropped |
| E19 | teams-chat, 1760004720000 and 1760007900000 | Same chat as T-0021: same topic is an update proposal, another topic a new item |
| E20 | `fixtures/outlook-calendar/basic`, the Mk4 FAI | Already tracked through T-0029's `cal` ref: nothing new |
| E21 | outlook-calendar, the Fable go/no-go | Moved from 21 to 23 Oct: reported against T-0020, which gains the new `cal` ref |
| E22 | outlook-calendar, Calderbrook and open day; helper test "local…" | Due times 26 Oct 09:00 (GMT Standard Time) and 24 Oct 09:00 (from UTC) |
| E23 | outlook-calendar with `transcripts: organizer-only` | Action items owned by others become waiting-for items |

`<source>.basic.expected.json` also lists the expected results that aren't tied to a numbered eval.
