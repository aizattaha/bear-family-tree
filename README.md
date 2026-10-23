# Bear Family Tree 🐻

A private, editable family tree for a big family — per-viewer nicknames, one-side-per-couple
focus navigation, living-in flags, memorials, blended families, claim-based stewardship.

- **Live:** https://aizattaha.github.io/bear-family-tree/ — GitHub Pages. `.github/workflows/pages.yml`
  publishes the `app/` folder about 20 seconds after every change lands on `main`.
- **App:** `app/index.html` — a single self-contained file, no build step. "Try the local demo"
  runs entirely in the browser with made-up people.
- **Backend:** Supabase (auth + Postgres with Row-Level Security), Free plan. The whole database
  history lives in `supabase/migrations/`, applied with `supabase db push`. **Database first,
  then app**, and a fresh backup before every push, run from this folder (not a worktree).
- **Database change rules** (checked on every pull request by `tests/migration-rules.sh`): a
  migration that is on `main` is never edited, renamed or deleted — a change goes in a new file;
  a new file's 14-digit version must sort after the newest on `main`. (Versions up to
  `20261025090000` were dated ahead of the clock, so until then name a new file after the newest
  one instead of using `supabase migration new`'s timestamp.) Never press GitHub's **Revert** on a
  change that includes a migration (RUNBOOK §3).
- **Checks:** every pull request runs `.github/workflows/checks.yml` — a throwaway Supabase with
  every migration, the permission tests (`tests/permissions.mjs`) and a demo smoke test in
  headless Chrome (`tests/smoke.mjs`). `main` only accepts changes through a pull request whose
  checks are green and up to date with `main`. Run them on a Mac: `bash tests/ci-stack.sh
  <empty folder> 568`, then in `tests/`: `npm ci`, `node permissions.mjs` (with the printed
  settings), `node smoke.mjs`; and `bash tests/migration-rules.sh`.
- **Running it:** `RUNBOOK.md` — site down / database paused, restore a backup, undo a bad
  release, remove a relative's access, a forgotten password, inviting a relative.
- **No emails:** sign-up has no "confirm your email" step, and a forgotten password comes back
  through a tree keeper's one-time reset code (`issue_reset_code` / `redeem_reset_code`) — the code
  alone finds the login, and the member is told who reset it (`my_password_resets`). Invites go
  face to face by QR code (`make_qr_invite` / `open_invite`: 5 minutes to scan, then 10 to sign
  up) or as a 14-day link sent by WhatsApp, to one person only; "not me" cancels one
  (`decline_invite`). Used invites are kept, with counts for keepers (`invite_funnel`).
- **Tree keepers** (`nucleus.is_super` in the database, up to 3 per tree) look after invites and
  reset codes. **New trees** need a keeper's one-time start-a-tree link (`make_newtree_code` →
  `create_tree`); one tree per login, at most 5,000 people per tree.
- **Docs:** `INSTRUCTIONS.md` (how to use it), `family-tree-concept.md` (product spec),
  `wireframe.html` (the annotated wireframe it was built from).

The Supabase key in the app is the *publishable* key — safe to be public; all access is enforced
by RLS in the database. This repository is public: no personal data, backups, logins or secret
keys ever go in it (review notes in `reviews/` stay on the Mac — they're git-ignored).

Built with Claude Code, from July 2026.
