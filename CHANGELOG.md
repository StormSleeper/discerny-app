# Changelog

What's changed in Discerny, newest first. Each line is one build. A dated section is a release, which you get by pulling `main`. The Unreleased section holds builds on `dev` that haven't been released yet. See the Version section of the README for what the numbers mean.

## Unreleased

- The folder page shows which version of Discerny you have, and `node tools/discern.mjs --version` prints it.
- New data folders get a DISCERNY.md that records their Format, and `discern check` says whether a folder's Format matches the app's.
- Discerny now refuses to open a data folder in a different Format, and tells you how to upgrade it or which app to use instead.
- Discerny can now upgrade a data folder made by an older version to the current format, keeping a backup beside it first.
- The Example's dates can be brought up to today with `node tools/refresh-dates.mjs` in its folder.
- Ask your agent to "upgrade my Discerny folder" and it takes the folder through the Upgrade with you, showing each change before making it.
- The Example now has the same line endings on Windows as on Linux and macOS, so the helper tests pass on Windows too.
- An All items page lists everything open, grouped and sorted as you choose, with a tag filter and a search that shows every match; quick add can now set the Urgency and a Description.
- The navigation panel now shows which version of Discerny you're running at its foot; with the sidebar collapsed, hover over the logo to see it.
- Run `node tools/discern.mjs serve` and open the address it prints to use Discerny in any browser, Firefox and Safari included, with no folder to choose; opening `discerny.html` in Chrome or Edge works as before.
- The app folder now records the connected data folder as `data_folder` in `config.toml` instead of `data-folder.txt`, and moves an existing `data-folder.txt` over the next time you connect.
- In a page opened with `discern serve`, Change folder now opens another data folder from inside the page, in any browser, and `serve` starts even before a folder is connected.
- The earlier four-page version of the UI, discerny-old.html, has been removed; discerny.html is now the only page.
- The instructions, skills, README and file headers now use one name for each thing throughout, and the README describes the Agent tab and the Ask agent button as the UI has them.
- The page's labels now match the docs: Urgency choices read Today, This week, Soon, Later and FYI; an Item's links are Relationships and its web addresses are URLs; dependencies show as "Depends on" and "Needed by"; and the Inbox asks you to clarify proposals.
- Mark an item done from its panel (or straight from the inbox), snooze a due date by a day, three days, a week or four weeks, add systems and URLs to an item, find done items when relating, and copy a person's, project's or system's ID from its page.
- Every meeting on your calendar for the coming days now goes straight into your open items and is kept up to date when it moves or is cancelled; the mail skill no longer proposes invitations, only replies to them that you need to answer.
- After time away, mail and Teams checks catch up over several runs and tell you how many days are still to read, Refresh keeps going until they're caught up, and a Meeting you declined but kept on your calendar now shows as cancelled.
- Asks and pre-reads about a meeting now arrive as their own task, due before the meeting, instead of an edit to the meeting, and calendar checks only suggest preparing for meetings they haven't seen before.
