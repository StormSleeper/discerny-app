# Migrations

A Migration brings a data folder from one Format to the next. This folder holds every Migration the app has ever had, and `discern upgrade` runs the ones a folder still needs. This file is for whoever writes one.

## Names

Each Migration is a folder named after the build that introduced it, such as `0.2.0.1`. That build's Format is the one the Migration leaves a folder in. The names give the order, so nothing else lists them.

While you write a Migration on a feature branch, its folder is `next`, and `var FORMAT` in `discerny.html` is `'next'`. `next` counts as newer than any numbered Migration, so `discern upgrade` runs it last. When the branch lands, the release tooling renames `next` to the build's number and sets `FORMAT` to match, in one step. You never need to know the number while you write it.

A folder that `next` has upgraded records Format `next`. Every app without that `next` refuses it, so a test copy is never mistaken for real data.

## What a Migration holds

A script, instructions, or both.

### The script: `migrate.mjs`

`discern upgrade` runs it as `node migrate.mjs <data folder>`, and adds `--write` to apply it.

- It runs on plain Node and imports only Node's built-in modules (`node:fs`, `node:path` and so on). It never loads the app's `//<core>` parser or anything else from the app. The parser will change, and the Migration has to keep working on the Format it was written for.
- Without `--write` it changes nothing. It prints a preview of every change it would make, file by file, clearly enough for the user to say yes to it.
- With `--write` it makes those changes.
- It exits non-zero on failure, and says why on stderr. The Upgrade then stops there and keeps the Migrations already recorded.
- It leaves alone anything it has already changed. Running it twice, or on lines already in the new Format, changes nothing the second time.
- It keeps each file's line endings, and never leaves a file empty.
- It doesn't touch `DISCERNY.md`. `discern upgrade` records the Format version once the Migration is done.

### The instructions: `INSTRUCTIONS.md`

The steps that need judgement, which a script can't make safely. An agent carries them out with the user: the `discern-upgrade` skill does this.

The top of the file says whether they're optional, on a line of its own: `Optional: yes` or `Optional: no`. `discern upgrade` refuses a file without that line.

Instructions are optional only when all they do is fill in a new optional field from what open Items already say. They leave Done Items alone, and leave the field empty where an Item doesn't say. Anything else is required.

- **Optional** instructions can be declined. `discern upgrade --write` declines them itself and says so, and the Migration still counts as done. The user can have them carried out later.
- **Required** instructions stop `discern upgrade --write` with exit 2 once the script has run. After they're carried out, `discern upgrade --done <version>` records the Migration, and the Upgrade carries on.

## A landed Migration never changes

Folders that have already run a Migration stay as it left them, so changing it afterwards would split users into two Formats. If a landed Migration has a mistake, a later Migration fixes it.

## Trying a Migration on a copy of the Example

Work on a copy, never on `discerny-example` itself:

```
cp -r ../discerny-example /tmp/try
node tools/discern.mjs upgrade --dir /tmp/try
node tools/discern.mjs upgrade --write --dir /tmp/try
node tools/discern.mjs check --dir /tmp/try
```

The first command lists the pending Migrations and shows the next one's preview. The second backs the copy up to `/tmp/try.backup-<format>`, runs them, and stops at any required instructions. Carry those out by hand on the copy, then run `upgrade --done <version>` and `upgrade --write` again. Run the script a second time to check it changes nothing, and compare the copy with its backup to see exactly what it did.
