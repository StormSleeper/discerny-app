# Changelog

What's changed in Discerny, newest first. Each line is one build. A dated section is a release, which you get by pulling `main`. The Unreleased section holds builds on `dev` that haven't been released yet. See the Version section of the README for what the numbers mean.

## Unreleased

- The folder page shows which version of Discerny you have, and `node tools/discern.mjs --version` prints it.
- New data folders get a DISCERNY.md that records their Format, and `discern check` says whether a folder's Format matches the app's.
- Discerny now refuses to open a data folder in a different Format, and tells you how to upgrade it or which app to use instead.
- Discerny can now upgrade a data folder made by an older version to the current format, keeping a backup beside it first.
