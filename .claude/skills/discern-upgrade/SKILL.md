---
name: discern-upgrade
description: Upgrades a Discerny data folder in an older Format to the app's, one Migration at a time, showing each change and waiting for the user's yes before making it, and carries out any steps that need judgement with them. Use when asked to upgrade a Discerny folder or bring it up to date, when the helper or the UI has refused a folder for being in an older Format, or when asked to re-run an optional Migration the folder has already passed.
---

# discern-upgrade

Find the Discerny data folder as "Start here" in `AGENTS.md` says, and follow its "Rules for every edit". Run the helper from the app folder: `node tools/discern.mjs <command> --dir <data folder>`. `migrations/README.md` says what a Migration holds, if you need more than this skill gives.

Never change the folder before the user has seen what will change and said yes. Never edit `DISCERNY.md`: only the helper records the Format. When you edit a file yourself, keep its line endings. A field a Migration fills in is not a change to the record, so it gets no `hist:` line and no new `chk:` date.

## Upgrade

1. Run `upgrade`. It changes nothing. If `pending` is empty, tell the user the folder is up to date and stop. If it refuses the folder as newer (exit 2), tell the user what it says and stop.
2. Tell the user the folder's Format, the app's, and the pending Migrations in order, and that a backup copy is made beside the folder before the first change.
3. Take the pending Migrations one at a time, oldest first:
   1. Show the preview from `upgrade`: the changes the script would make, file by file, in full. A Migration with no script has no preview: say so, and summarise what its `migrations/<version>/INSTRUCTIONS.md` would do instead.
   2. Ask whether to apply it, and wait for a yes. Make it one question per Migration. If it has optional instructions, ask in the same question whether to carry them out, since the user can decline them and still apply the Migration. If it has required instructions, say that they come with a yes.
   3. On a yes, run `upgrade --write --one`. It backs the folder up beside it, every time, and runs the script if there is one. Note the `backup` it reports. A Migration with instructions isn't recorded yet: the output's `next` says so.
   4. If the Migration has instructions and the user hasn't declined them, read `migrations/<version>/INSTRUCTIONS.md` and carry them out with the user, as it says. A field it adds that `AGENTS.md` doesn't list yet goes where the instructions say, or else at the end of the meta. Required instructions can't be skipped: if the user won't go on with them, stop as in step 4.
   5. If the Migration has instructions, record it with `upgrade --done <version>` once they're carried out or declined. Without instructions, `--one` has already recorded it.
   6. Run `upgrade` again for the next Migration's preview.
4. If the user says no, or a command fails, stop. Don't try to fix a failed script. Run `upgrade` for the Format the folder is now in, and tell the user:
   - the folder is part-way through its Upgrade, at that Format;
   - the UI and the helper will refuse the folder until the Upgrade is finished, which they can do by asking you again;
   - where the backups are, and that restoring the oldest one puts the folder back as it was.

   Don't offer to delete the backups, then end with the closing line below.
5. When nothing is pending, run `check` and report:
   - the Format the folder was in and the one it's in now;
   - each Migration, and what it changed, or that its instructions were declined;
   - any problems `check` found;
   - where the backups are, one per Migration. Offer to delete them, and delete them only on a yes.

## Re-run a declined Migration

A declined optional Migration still counts as done, so `upgrade` no longer lists it. To carry out its instructions later:

1. If the user hasn't said which, list the Migrations in `migrations/` with an `INSTRUCTIONS.md` that says `Optional: yes`, and ask.
2. Run `check`. The folder must be in the app's Format: if it isn't, upgrade it first.
3. Carry out the instructions as in step 3.4 above: show the user what you'll change and wait for their yes. They work on open Items only, and fill in only fields that are still empty. Later Migrations may have changed the Format since these instructions were written: where they contradict the formats in `AGENTS.md`, follow `AGENTS.md` and tell the user. A field `AGENTS.md` doesn't mention is no contradiction.
4. Don't run `upgrade` or `--done`: the Format doesn't change.

End with one line: the Format before and after, the Migrations applied, declined or re-run, and where the backups are.
