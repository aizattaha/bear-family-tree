# Bear Family Tree 🐻

A private, editable family tree for a big family — per-viewer nicknames, one-side-per-couple
focus navigation, living-in flags, memorials, blended families, claim-based stewardship.

- **App:** `app/index.html` — a single self-contained file, no build step.
- **Backend:** Supabase (auth + Postgres with Row-Level Security). The full database history
  lives in `supabase/migrations/` (applied via `supabase db push`); optional live-sync in
  `supabase/enable-realtime.sql`.
- **Docs:** `INSTRUCTIONS.md` (how to run and use), `family-tree-concept.md` (product spec),
  `wireframe.html` (the annotated wireframe it was built from).

Deployed via Netlify (`netlify.toml` publishes the `app/` folder). The Supabase key in the app
is the *publishable* key — safe to be public; all access is enforced by RLS in the database.

Built with Claude Code, July 2026.
