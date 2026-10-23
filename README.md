# Bear Family Tree 🐻

A private, editable family tree for a big family — per-viewer nicknames, one-side-per-couple
focus navigation, living-in flags, memorials, blended families, claim-based stewardship.

- **Live:** https://aizattaha.github.io/bear-family-tree/ — GitHub Pages. `.github/workflows/pages.yml`
  publishes the `app/` folder about 20 seconds after every change lands on `main`.
- **App:** `app/index.html` — a single self-contained file, no build step. "Try the local demo"
  runs entirely in the browser with made-up people.
- **Backend:** Supabase (auth + Postgres with Row-Level Security), Free plan. The whole database
  history lives in `supabase/migrations/`, applied with `supabase db push`. **Database first,
  then app**, and a fresh backup before every push.
- **Checks:** every pull request runs `.github/workflows/checks.yml` — a throwaway Supabase with
  every migration, the permission tests (`tests/permissions.mjs`) and a demo smoke test in
  headless Chrome (`tests/smoke.mjs`). `main` only accepts changes through a pull request whose
  checks are green. Run them on a Mac: `bash tests/ci-stack.sh <empty folder> 568`, then in
  `tests/`: `npm ci`, `node permissions.mjs` (with the printed settings), `node smoke.mjs`.
- **Running it:** `RUNBOOK.md` — site down / database paused, restore a backup, undo a bad
  release, remove a relative's access.
- **Docs:** `INSTRUCTIONS.md` (how to use it), `family-tree-concept.md` (product spec),
  `wireframe.html` (the annotated wireframe it was built from).

The Supabase key in the app is the *publishable* key — safe to be public; all access is enforced
by RLS in the database. This repository is public: no personal data, backups, logins or secret
keys ever go in it (review notes in `reviews/` stay on the Mac — they're git-ignored).

Built with Claude Code, from July 2026.
