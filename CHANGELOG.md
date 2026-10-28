# Changelog

What's changed in Discerny, newest first. Each line is one build. A dated section is a release, which you get by pulling `main`. The Unreleased section holds builds on `dev` that haven't been released yet. See the Version section of the README for what the numbers mean.

## Unreleased

- The installed app's icon now has a transparent background, so it no longer shows as a pale square on a dark taskbar.
- The installed app's taskbar icon is now larger and clearer, showing just the binoculars.

## 0.3.0.8 (2026-10-25)

### What's new

**Comments and Descriptions**
- **Each item, project, system and person now has a Description and a list of Comments**, each with its time and author. These replace notes.
- **News waits for you in the Inbox.** When your source skills find news on an item, it appears under **New comments** until you acknowledge it.
- **Changes come with an undo.** When a refresh finds a new Due date, status or job title, it makes the change and shows it under New comments, where you can undo it. News that work is finished lets you mark the item done.

**The Inbox**
- **The Inbox asks about what your source skills found:** relationships, new people, new email addresses, and whether to make someone a Priority person. Add each with one click, or say no for good.
- **Dismissing a Proposal now forgets only that message**, so a later email on the same thread that needs action is proposed again.
- **"Already handled" marks the Proposal done** instead of dismissing it.

**Duplicates**
- **You can merge a duplicate item into the item it duplicates**, from the item's page. Dismissing a Proposal as Duplicate now merges it too, so nothing it carried is lost.

**Data files and look**
- **Your data files use readable field names**, such as `status`, `urgency` and `due-date` in place of short codes.
- The Discerny logo in the sidebar and on the folder screen is larger and easier to see.
- The Example has sample Comments, field changes and Inbox questions to try straight away.

### Upgrading

This Release changes how Data folders are written, so **each Data folder needs the Upgrade** before this version will open it.

- `node tools/discern.mjs upgrade` lists what will change, without touching anything.
- `node tools/discern.mjs upgrade --write` backs the folder up first and then applies the changes.
- The **discern-upgrade** Skill runs the steps that need an Agent. Ask your agent to "upgrade my Discerny folder".

What this Upgrade changes:

- **0.3.0.1:** Dismissed Proposals are no longer kept in `IGNORED.md`. A new `DISMISSED.md` remembers each dismissed message until its source has moved past it.
- **0.3.0.2:** `INBOX.md` and `IGNORED.md` are reworded to hold proposed changes and your No to them. No data changes.
- **0.3.0.3:** Notes become Descriptions and Comments, and you become person P-0001. Your agent checks that P-0001 is really you and fixes it if not.
- **0.3.0.7:** `INBOX.md` and `IGNORED.md` are reworded for Priority person questions. No data changes.
- **0.3.0.8:** Every field gets its readable name and layout, across all data files and `SOURCES.md`. Free text stays as written.

## 0.2.0.1 (2026-10-23)

### What's new

- **Discerny has its own icon** in the browser tab and on bookmarks. The browser's bars now match the app's light or dark theme.
- **Install it as an app.** In Chrome or Edge, a page served by `discern serve` can be installed as an app with its own window. The sidebar shows the Discerny icon.

### Upgrading

This Release changes how Data folders are written, so **each Data folder needs the Upgrade** before this version will open it.

- `node tools/discern.mjs upgrade` lists what will change, without touching anything.
- `node tools/discern.mjs upgrade --write` backs the folder up first and then applies the changes.
- The **discern-upgrade** Skill runs any steps that need an Agent. Ask your agent to "upgrade my Discerny folder".
- `discern upgrade` replaces `discern migrate`, which has been removed.

What this Upgrade changes:

- **0.2.0.1:** The folder now records its Format. Older Source keys are brought up to date: a whole-chat Teams key gains `|*`, and an open Meeting with a date and an email key, but no calendar key, gains one.

## 0.1.1.19 (2026-10-21)

No Upgrade is needed: data folders from v0.1.0.0 work as they are.

### Use Discerny in any browser
- Run `node tools/discern.mjs serve` and open the address it prints to use Discerny in any browser, Firefox and Safari included. Opening `discerny.html` in Chrome or Edge works as before.
- In a served page, Change folder opens another data folder from inside the page, and `serve` starts even before a folder is connected.
- The connected data folder is now kept as `data_folder` in the app folder's `config.toml`. An existing `data-folder.txt` moves over the next time you connect.
- The earlier four-page UI, `discerny-old.html`, has been removed. `discerny.html` is now the only page.

### Working with items
- A new All items page lists everything open, grouped and sorted as you choose, with a tag filter and a search that shows every match.
- Quick add can set the Urgency and a Description.
- Mark an item done from its panel or straight from the inbox, and snooze a due date by a day, three days, a week or four weeks.
- Add systems and URLs to an item, find done items when relating, and copy a person's, project's or system's ID from its page.
- Labels match the docs: Urgency reads Today, This week, Soon, Later and FYI; an item's links are Relationships and its web addresses are URLs; dependencies show as "Depends on" and "Needed by"; and the Inbox asks you to clarify proposals.

### Mail, Teams and calendar
- Every meeting on your calendar for the coming days now goes straight into your open items, and stays up to date when it moves or is cancelled.
- A meeting you declined but kept on your calendar shows as cancelled.
- Asks and pre-reads about a meeting arrive as their own Task, due before the meeting. Calendar checks only suggest preparing for meetings they haven't seen before.
- Mail leaves invitations to the calendar and proposes only the replies you need to answer, Accepted and Tentative ones included. If your mail settings filter those replies out, the mail check offers to remove the filter.
- After time away, mail and Teams checks catch up over several runs and tell you how many days are still to read. Refresh keeps going until they're caught up.

### Versions and Formats
- The navigation panel shows which version of Discerny you're running, and `node tools/discern.mjs --version` prints it.
- New data folders get a `DISCERNY.md` that records their Format, and `discern check` says whether a folder's Format matches the app's.
- Discerny refuses to open a data folder in a different Format, and tells you how to upgrade it or which app to use instead.
- From now on, Releases that change the Format can be applied with `node tools/discern.mjs upgrade`, which backs the folder up first. You can also ask your agent to "upgrade my Discerny folder" and it takes you through each change before making it.

### Docs and the Example
- The instructions, skills, README and file headers use one name for each thing throughout.
- The Example's dates can be brought up to today with `node tools/refresh-dates.mjs` in its folder.
- The Example has the same line endings on every platform, so the helper's tests pass on Windows too.
