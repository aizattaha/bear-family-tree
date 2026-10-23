# Bear Family Tree — what to do when… (runbook)

Plain steps for Aizat. When a step says **ask Claude**, open a Claude Code session in this
folder and paste the sentence in quotes.

## What runs by itself on the Mac
| Job | When | Where it writes |
|---|---|---|
| **Daily keep-awake check** (`com.bearfamilytree.keepawake`) | every day at 9:00, on wake if the Mac was asleep, and at login | one line per run in `~/Library/Logs/BearFamilyTree-keepawake.log`, with the newest weekly backup's age and the database's size; a pop-up if the database doesn't answer, **if the newest weekly backup is more than 8 days old**, or **if the database passes 300 MB** (the free plan stops at 500 MB) |
| **Weekly backup** (`com.bearfamilytree.backup`) | Sundays 10:00 (or on next wake) | Google Drive → Aizat → Backups → bear-family-tree → `YYYY-MM-DD_weekly` (the newest 8 are kept) |

Both only work while the Mac is switched on. A Mac switched off for more than 7 days lets the
free database go to sleep (see 1).

**Going away for more than 5 days?** Leave the Mac plugged in, switched on and logged in (lid
open, or closed with a screen attached), so the daily check keeps the database awake and Sunday's
backup runs — or **tell Claude before you go**: "I'm away from <date> to <date>, keep Bear Family
Tree awake." When you're back, the pop-up "Bear Family Tree backup is old" means Sunday's backup
didn't run: open Docker Desktop, then **ask Claude**: "Run the Bear Family Tree weekly backup now".

**See the last few keep-awake checks:** press ⌘ + Space, type `Terminal`, press Enter, paste this
and press Enter:
```bash
tail -5 ~/Library/Logs/BearFamilyTree-keepawake.log
```
Good lines look like `2026-10-24 09:00  OK    HTTP 200 in 0.2s · backup 1 day old · database 20 MB`.
`SKIP` means the Mac had no internet at that moment (it tries again next time). `DOWN` means see 1.
`OLD BACKUP` means the newest weekly backup is more than 8 days old — see "Going away" above.
`BIG` means the database passed 300 MB — **ask Claude** "Why is the Bear Family Tree database big?".

---

## 1. The site is down, or the database is asleep
**Signs:** a Mac pop-up "Bear Family Tree database not answering — open Supabase and press
Restore", or relatives see "Can't reach the tree".

1. Open https://aizattaha.github.io/bear-family-tree/ in Safari.
   - **The page doesn't open at all** → it's GitHub's side. Check https://www.githubstatus.com and
     try again later. Nothing in the family's data is affected.
   - **The page opens but says "Can't reach the tree"** → go on to step 2.
2. Open https://supabase.com/dashboard and sign in (your Supabase login from your password manager).
3. Click the project **bear-family-tree**. If it says **Paused**, click **Restore project**.
   It takes 2–5 minutes; wait until it shows as healthy. (A paused free project can still be
   restored later, but do it the same day, so relatives aren't locked out.)
4. Reload the family tree page and sign in — everything should be as it was.
5. Check the daily job sees it too — in Terminal (⌘ + Space, `Terminal`, Enter), paste:
   ```bash
   launchctl kickstart gui/$(id -u)/com.bearfamilytree.keepawake; sleep 3; tail -1 ~/Library/Logs/BearFamilyTree-keepawake.log
   ```
   You should see a new line ending in `OK    HTTP 200 …`. If it says `DOWN`, wait 5 minutes and run it again.
6. Tell Claude: "The Bear Family Tree database was paused and I restored it on <date>."

## 2. Restore a backup (only for a real disaster)
A full restore puts **everyone's** data back to the day of the backup — every edit since is lost.
For one wrong change ("someone changed Grandma's birth year"), don't restore: **ask Claude**
"Fix one Bear Family Tree record from the latest backup: <what went wrong>".

- Backups live in Google Drive → Aizat → Backups → bear-family-tree:
  - `YYYY-MM-DD_weekly` — the automatic Sunday copies;
  - `YYYY-MM-DD_HHMM-before-…` — taken by hand before every database change.
- They hold the family's real data: never open them, email them or put them in the project folder.
- **Ask Claude:** "Restore the Bear Family Tree database from the backup folder <folder name>."
  The session will first back up what's there now, load your chosen backup into a throwaway copy
  on the Mac and compare the numbers with you, and only then — with your OK — put it live.
- Practised on 23 Oct 2026: the weekly backup and that day's backup both loaded and matched
  (the only error is the empty photo-storage list, which is harmless).

## 3. Undo a bad release
> ⚠️ **If the change lists a file under `supabase/migrations` (look at the "Files changed" tab),
> don't press Revert — ask Claude:** "Undo the Bear Family Tree change <name>; it has a database
> part." Reverting would take the database file out of the code while the live database keeps the
> change, and the next database update would then fail. Claude writes a new change that undoes
> both, tests it, and asks you before it goes live.

**A change with no `supabase/migrations` file — you can undo it yourself:**
1. Open https://github.com/aizattaha/bear-family-tree/pulls?q=is%3Apr+is%3Amerged and sign in.
2. Click the change that broke things (the newest is at the top). Open **Files changed** and check
   no file starts with `supabase/migrations` (if one does, stop — see the warning above).
3. Click **Revert** (bottom of the page), then **Create pull request**.
4. Wait 3–5 minutes for the green tick next to **database + app checks**.
5. Click **Merge pull request**, then **Confirm merge**. The old version is live about a minute later.
   Phones may keep the broken page for up to 10 minutes — pull down to reload.
6. Tell Claude what happened, so it can be fixed properly.

**Database changes can't be undone with a button.** **Ask Claude:** "Undo the Bear Family Tree
database change <name or date>." It writes a new change that reverses it, tests it on a copy,
takes a backup, and asks you before it goes live. A full restore (2) is the last resort.

If the checks themselves are broken (red for a reason unrelated to the change) and a fix is
urgent: **ask Claude** — as the owner you can switch the rule off for a moment at GitHub →
Settings → Branches, but only do that with a session guiding you.

## 4. Remove a relative's access
There's no button for this in the app yet. It's done in Supabase:
1. Open https://supabase.com/dashboard → project **bear-family-tree** → **Authentication** → **Users**.
2. Find their email, click **⋯** at the end of the row → **Delete user** → confirm.
   - Their login stops working straight away. This can't be undone (they'd need a new invite).
   - Their household and the people it claimed stay in the tree, still marked as theirs. To let the
     family edit those profiles again, a tree keeper (⭐) opens each profile in the app and taps
     **release this claim** (it's recorded who did it and when).
3. In the app, open ⭐ **Tree keeper settings** (on a phone: **⋯** → **Tree keeper settings**) →
   **Invites** and delete (or **stop**) any invite codes they might still have.
4. If they were a tree keeper (⭐), check ⭐ Tree keeper settings: there must always be at least one other.

## 5. A relative forgot their password
Nothing is ever emailed. A tree keeper (⭐) gives them a one-time **reset code** instead, and they
keep the same login. **They don't need to remember their email** — the code alone finds their login.
1. In the app, open the relative's card (tap them on the tree, or type their name in search).
2. Tap **🔑 help … back in** near the top. The question names their household and who is in it
   (e.g. "Nia's household (Nia Rahman)") — check it's the right person, then **OK**. (Only keepers
   see it, and only on a claimed profile. A card that says "unverified" has no login yet — send an
   invite instead.)
3. A code like `K7PM-4XQR` appears. Tap **💬 WhatsApp** and pick the relative (never a group), or
   **copy message**, or read it out on a call. Before you send it, make sure it's really them
   asking — a call, or a message from their usual number.
4. They open https://aizattaha.github.io/bear-family-tree/, tap **Forgot your password?**, type the
   code and a new password (at least 6 characters), then **Save new password**. The app shows them
   **which email their login uses** (so they can write it down) and signs them straight in.

Good to know:
- A code works **once, for 30 minutes**. Making a new code stops the old one.
- 5 wrong tries use a code up. If **20 wrong codes** are tried in half an hour (by anyone),
  every reset pauses for 30 minutes — wait, then try again (make a fresh code if theirs ran out).
- At most 3 codes can be waiting in the tree at once.
- The relative is told: the next time they open the app on any other phone, it says **"your
  password was reset — a tree keeper from <household> made a reset code … used on <date>"**, and
  their own card always shows when it was last reset. If they didn't ask for it, they'll tell the
  family.
- Anyone else signed in on that login (a shared household login) is signed out and needs the new
  password.
- Every code is recorded (which keeper, for whom, when, used or not). **Ask Claude:** "Show me the
  Bear Family Tree reset codes made this month."
- A household with two logins can't get a code (the app says so) — **ask Claude**.

## 6. Invite a relative (QR code or WhatsApp — no emails)
Only tree keepers (⭐) can invite. An invite is for one person who is already on the tree but
has no login yet (their card says "unverified"). Nobody can be invited to take the place of
someone with a memorial (the button isn't there).

**The rule until the keeper "confirm" step exists:** show the QR code face to face, or send the
link **to that one person only — never to a group, never at a gathering or on a shared screen.**
Whoever signs up with it takes the place straight away.

**When they're with you (best):**
1. Open their card (tap them on the tree, or type their name in search).
2. Tap **✉ invite … to claim this profile**. A big QR code appears, with "works for 4:59".
3. Hold your phone out. They open their phone's **Camera**, point it at the code and tap the
   link that pops up.
4. On their phone they first see **"Is this you?"** — the name of their place (e.g. "Daughter of
   Aizat & Paige") and the first names of their close family. They tap **Yes, that's me**. Then
   **Create account** (their email + a password, at least 6 characters) → **Take my place**.
   They're in, as themselves, and their household is named after them ("Nia's household").
   If it isn't them, they tap **not me** → **Cancel this invite**: the code stops working at once.
5. Your screen shows "✓ scanned — … has 10 minutes to finish signing up, until 2:59 pm", then
   "🎉 … has taken their place on the tree" — or "🚫 … said this isn't them", with a refresh button.

Good to know:
- The code must be **scanned within 5 minutes**. After that it greys out: tap **↻ refresh** for
  a new one (the old one stops working).
- Once scanned, they have **10 minutes** to finish signing up.
- **Whoever signs up with it first gets the profile**, so only show it to the right person. If
  someone else scanned it, tap **not …? cancel this code**, then refresh.
- Closing the sheet deletes a code nobody scanned.

**When they're far away:** on the same sheet, under **💬 Not with you? Send a link**, tap
**make a 14-day link** → **💬 WhatsApp** and pick them — them only, never a group (or **copy
link**). The link works once, for 14 days. If the wrong person opens it, they tap **not me** and
it's cancelled; the next time you open the app it tells you, so you can send a new one.

**Anyone in the family (not a particular card):** ⭐ **Tree keeper settings** → **Invites** →
**✉ create** → **💬 WhatsApp** — to one person at a time, never a group chat. Whoever uses it
then finds themselves on the tree and claims their place. ⭐ **Tree keeper settings** →
**Invites** lists every invite that still works, with **delete** (or **stop**, once someone has
joined with it), and **Invites so far** shows the numbers: made, opened, joined, "not me".

**Households:** ⭐ Tree keeper settings lists every household with the people in it, so you can
tell "Nia's household" from the next. Tap **make keeper** to add a tree keeper (up to 3).

## 7. A friend wants their own, separate tree
New trees can only be started with a keeper's one-time link (so strangers can't fill the family's
free database). Open your own card → **Invite a friend to start their own tree** → **✉ share** →
**💬 WhatsApp** to that friend. The link works once, for 14 days; each login can start one tree,
and a tree holds up to 5,000 people.

## Turning the Mac jobs off or on
In Terminal (⌘ + Space, `Terminal`, Enter):
```bash
launchctl bootout gui/$(id -u)/com.bearfamilytree.keepawake
```
stops the daily check;
```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.bearfamilytree.keepawake.plist
```
starts it again. Use `com.bearfamilytree.backup` in both commands for the weekly backup.
