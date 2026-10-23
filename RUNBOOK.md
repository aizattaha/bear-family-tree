# Bear Family Tree — what to do when… (runbook)

Plain steps for Aizat. When a step says **ask Claude**, open a Claude Code session in this
folder and paste the sentence in quotes.

## What runs by itself on the Mac
| Job | When | Where it writes |
|---|---|---|
| **Daily keep-awake check** (`com.bearfamilytree.keepawake`) | every day at 9:00, on wake if the Mac was asleep, and at login | one line per run in `~/Library/Logs/BearFamilyTree-keepawake.log`; a pop-up if the database doesn't answer |
| **Weekly backup** (`com.bearfamilytree.backup`) | Sundays 10:00 (or on next wake) | Google Drive → Aizat → Backups → bear-family-tree → `YYYY-MM-DD_weekly` (the newest 8 are kept) |

Both only work while the Mac is switched on. A Mac switched off for more than 7 days lets the
free database go to sleep (see 1).

**See the last few keep-awake checks:** press ⌘ + Space, type `Terminal`, press Enter, paste this
and press Enter:
```bash
tail -5 ~/Library/Logs/BearFamilyTree-keepawake.log
```
Good lines look like `2026-10-24 09:00  OK    HTTP 200 in 0.2s`. `SKIP` means the Mac had no
internet at that moment (it tries again next time). `DOWN` means see 1.

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
   It takes 2–5 minutes; wait until it shows as healthy. (Free projects can be restored for 90 days
   after they pause.)
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
**The website (app) part — you can do it yourself:**
1. Open https://github.com/aizattaha/bear-family-tree/pulls?q=is%3Apr+is%3Amerged and sign in.
2. Click the change that broke things (the newest is at the top).
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
3. In the app, open ⭐ **Super settings** → **Invites** and delete any invite codes they might
   still have.
4. If they were a tree keeper (⭐), check ⭐ Super settings: there must always be at least one other.

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
