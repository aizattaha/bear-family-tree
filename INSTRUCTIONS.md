# Bear Family Tree — how to run & use

**🌍 The family's home: https://aizattaha.github.io/bear-family-tree/** — share nothing else; sign in there from any phone or computer. (`app/index.html` still works locally for tinkering; the public GitHub repo `aizattaha/bear-family-tree` auto-deploys to GitHub Pages on every push via `.github/workflows/pages.yml`. Netlify is decommissioned.)

*Built July 2026 · follows Aizat's Personal Design System v2*

## 1. Run it (10 seconds)

**Double-click [`app/index.html`](app/index.html).** That's it — no server, no install, works in Safari/Chrome/Edge on Mac, Windows, iPad, phone.

Everything in this draft runs **locally in the browser** (localStorage). Each browser/device has its own copy of the data — that's the "first draft" trade-off until Supabase is connected (§5). Clearing browser site-data resets to the demo family.

## 2. Sign in

The login screen lists demo **households (nuclei)** — pick *Aizat & Sarah's household*, then pick yourself. A shared household login always asks *who's looking* (Netflix-style), because nicknames belong to the person, not the login.

## 3. What works (all of the spec)

| Feature | Where |
|---|---|
| **Per-viewer nicknames** | tap any person → "You call them" — saves instantly and relabels their node on *your* tree only. "Also known as" shows what everyone else calls them. Switch profiles (top chip) to see the whole tree relabel. |
| **Per-nucleus tree name** | "BearFamily" in the top bar is *your household's* name — ✎ to rename. Kak Ina's login calls the same tree "my family". |
| **Nucleus always in view** | you + partner + kids never get parked by focus mode; only their own ⊖ hides them. |
| **Expand / focus** | ⊕ pills grow a side (with people-count). **One side per couple** is the only auto-collapse: expanding upward parks your partner's side; opening Granny's side parks Atok's — two sibling fans can't share one couple. **Downward expansions never collapse**: open every aunt's and uncle's family at once and explore the whole tree. Focus bar top-left; "back to my view" resets. |
| **Map navigation** | drag to pan, scroll wheel zooms at cursor, pinch on touch, −/+ buttons, **◎ me** recentres, minimap bottom-right (click to jump), search flies to anyone (auto-expands the path to them). |
| **Node interactions** | **hover or single-click** a person → a floating **＋** appears (quick add-relative). **Double-click** opens their full sheet (view/edit). Click empty canvas to dismiss the ＋. |
| **Your own name** | your sheet has a **"You go by"** field — the name shown big on your own node (separate from your full name and from what others call you). |
| **Living-in flags** | flag pip top-right of each node; set in the person sheet. |
| **Passed relatives** | behind **+ more** in the person sheet (never face-up): a date (YYYY or YYYY-MM-DD, or type `unknown`) + "Shown as" phrasing dropdown grouped by tradition (Islam / Christian / Chinese / Generic / Custom). Node greys out, photo goes greyscale, flag disappears, memorial line appears. |
| **3 photos per person** | person sheet → young kid / teen · young adult / adult slots. ★ picks which one shows on the tree. Photos are auto-downscaled. |
| **Claim & 5-branch editing** | anyone can add a person (starts *unverified*); profiles are editable within **5 branches** until claimed; claimed profiles lock to their nucleus — except memorial phrasing, which stays family-stewarded. The sheet tells you why something is view-only. |
| **Add relatives** | "Add relative" on any sheet — Parent / Partner / Child / Sibling, anchored so nobody floats. |
| **Ordering rules** | siblings sit **oldest → youngest, left → right** (by the Born field — fill it in for correct order). Couples sit **husband left · wife right** (by the Gender field, under "+ more"); any couple can override with the **Couple side** field — set one partner to left or right and it wins, so every couple chooses their own arrangement. |
| **Stable positions** | expanding a side never reshuffles what's already on screen — new people slot in around the existing layout, and the node you expanded stays put under your cursor. |
| **Children card & fixing links** | every sheet lists the person's children. If their partner has children not linked to them (added before the marriage was), each shows **"link as X's child"** — one tap attaches the parent. |
| **Deleting someone** | open their sheet → **"remove [name] from the tree"** at the bottom (only on profiles you can edit; never yourself). Their links go too; children keep their other parent. |
| **Dating** | Partners card → status **dating**: the couple stands together joined by two blue slashes **∕∕** instead of a line. Requires `supabase/upgrade-3-dating.sql` (run once). |
| **Separations & divorce** | every person sheet has a **Partners** card: set a link to *separated* or *divorced* (+ year) and the couple line breaks with a **⫽ divorce mark and a blue "divorced · 2010" badge** — obvious at a glance. **Unlink** removes the link entirely: both people stay, children keep both parents, and an ex with no other connection drops off the canvas. |
| **Remarriage** | the current partner pairs solidly; the ex stays on the other side with the broken line, and shared children keep hanging under the *old* partnership — never under the new partner. See it seeded on Kamal (Granny's brother): Roslinda ⫽ Kamal — Aminah, with Hafiz below. **Married-in exes fade to 70% opacity** — still around, visibly no longer core family (different from deceased, which is greyscale + memorial line; exes keep colour and flag). |
| **Multiple concurrent marriages** | supported — the earliest marriage pairs; each additional current partner stands on the outer side with a solid line (no break, no fade), their children under them. |
| **Step-children** | "Add relative → Child of [name] **only**" links a child to one parent — their line drops from that parent alone, never the couple midpoint. Seeded: Iman (Aminah's son from her first marriage) hangs from Aminah, beside Hafiz who hangs from Kamal–Roslinda. |
| **Animation** | expanding/collapsing is animated: new people grow out of the node you tapped, collapsed ones retreat back into it, and the connecting lines fade in once everyone has settled. **The camera anchors to your nucleus** — it never moves when you expand, anywhere in the tree; deep blocks drift to make room instead. Honours reduced-motion settings. |
| **What an expansion shows** | a side-expansion brings parents + siblings **+ the siblings' current partners** automatically; children stay behind each couple's ⊕ family chip. Exception: **your own siblings' families (nieces & nephews) are visible by default**, with a ⊖ to fold them. |

## 4. Files in this folder

- `app/index.html` — the whole app (single file, no build step)
- `supabase/schema.sql` — full database schema + Row-Level-Security, ready to paste into Supabase
- `family-tree-concept.md` — the product spec (data model, RLS design, interaction rules)
- `wireframe.html` — the annotated wireframe the app was built from
- `INSTRUCTIONS.md` — this file

## 5. Cloud mode — CONNECTED ✓ (July 2026)

The app is wired to the live Supabase project (`garbnserzkuazmvonfem`). Opening `app/index.html` now shows a real **email + password sign-in**; "try the local demo instead" keeps the old browser-only playground (separate data, always available).

**First run (you):**
1. Open the app → **Create account** with your email + a password.
2. By default Supabase requires email confirmation — click the link it sends, then sign in. *(To spare the family this step: Supabase Dashboard → Authentication → Sign In / Providers → Email → turn off "Confirm email".)*
3. Onboarding → **Start a new family tree** → your name, household name, tree name → you land on a clean tree with just you. Add Sarah and the girls with "Add relative" + **claim** them into your nucleus, then build outward.

**Super users (run `supabase/upgrade-1-super-users.sql` once to enable):** the first household of the tree is automatically the super user; up to **3 per tree**, managed from your own profile sheet (*Super users* card — make / remove). Only super users can create invites.

**Inviting family — two ways (super users only):**
1. **Personal claim-link (the good one):** open any *unclaimed* person's sheet → **✉ invite [name] to claim this profile** → share the link or hit *send by email*. Whoever opens it creates an account and lands directly as that person — single use, valid 14 days.
2. **General code:** your own sheet → *Invite family* → **✉ create a code** — anyone with it can join and then claim/add themselves.

**Inviting a friend to start their OWN tree:** your own sheet → *Invite a friend to start their own tree* → **✉ share**. The link (`…#newtree`) lands them on a create-account page with a "create your own family tree!" banner, then straight into the start-tree form — they become the first super user of a completely separate tree. Trees never see each other.

**Tutorial:** every account walks through a 3-step tutorial on first entry (moving around · people & nicknames · making it yours). Reopen it any time from the **🎓** button in the top bar (hover: "tutorial").

**Syncing:** every edit writes through to the cloud instantly; screens refresh whenever a window regains focus. For live push (~1s) updates, run `supabase/enable-realtime.sql` once in the SQL Editor — optional.

**Photos** are stored in the database (simple + free-tier friendly at family scale). The `photos` storage bucket isn't needed for now.

**Is the key in the file safe?** Yes — it's the *publishable* key, designed to be public; every read and write is enforced by the Row-Level-Security rules in the database, not by secrecy.

## 5b. Putting it on a URL (next step)

Create a GitHub repo (e.g. `bear-family-tree`), push this folder, connect it to Netlify or Vercel → the family gets a link like `bearfamily.netlify.app`. Say the word and Claude preps the repo.

## 6. Known first-draft limits

- Data is per-browser (see §5) — the demo family (Atok, Granny, Tok Wan…) is seeded so you can feel every feature immediately.
- Layout is auto-computed each time; with very wide expansions lines can occasionally cross — pan/zoom or focus mode keeps it readable.
- "Sign out" is on your own profile sheet (tap your node).
- Photos count against browser storage (~5 MB) — fine for trying it out; Supabase Storage removes the limit.
