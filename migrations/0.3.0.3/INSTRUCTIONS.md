# Make sure P-0001 is the user

Optional: no

From this Format on, P-0001 is always the user, and no one else ever gets that ID. The script made the user's Person P-0001 when one Person's note said they were "the user of Discerny". These steps make sure it's right, and fix it when no Person said so.

1. Read the record with `id:P-0001` in `PEOPLE.md`.
2. If the script's preview said "The user is P-0001, … (found by the note saying so)" and that's the record you read, there is nothing to do. Otherwise ask the user: "Is <name> (P-0001) you?"
3. If they say yes, there is nothing more to do.
4. If they say no, ask which Person is them, and run this Migration's script again from the app folder with that Person's ID. It swaps the two IDs in every file of the folder, as it does for a Person found by the note:

   ```
   node migrations/<this Migration>/migrate.mjs <data folder> --user <their P-id>
   ```

   Show the user the preview, and on a yes run it again with `--write` added.
5. If the user has no Person yet, ask for their full name and run the script with `--new-user "<name>"` instead. It makes their Person, then swaps its ID with P-0001's, so the old P-0001 moves to the next free ID. Show the preview and add `--write` on a yes, as in step 4. Then ask them for their company, department, job title and the email addresses they send from, and fill those in on P-0001.
