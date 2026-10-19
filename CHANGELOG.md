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
