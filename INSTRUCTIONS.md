# Bear Family Tree — how to use it

**🌍 The family's home: https://aizattaha.github.io/bear-family-tree/** — share nothing else; sign in there from any phone or computer. The public GitHub repo `aizattaha/bear-family-tree` publishes `app/` to GitHub Pages about 20 seconds after every change lands on `main` (`.github/workflows/pages.yml`). How to run it day to day — site down, backups, a forgotten password, invites — is in `RUNBOOK.md`.

*Built from July 2026 · follows Aizat's Personal Design System v2*

## 1. Open it

Open the family's address above. Relatives sign in with an email and a password (one login per household, shared or personal). **try the local demo instead** on the sign-in screen opens a playground with made-up people that lives only in that browser — nothing in it reaches the real tree. (`app/index.html` opened from this folder works the same way.)

## 2. Sign in, or join

- **Already joined:** email + password. You stay signed in for 30 days on that phone or computer. **Forgot your password?** → a tree keeper's reset code + a new password — no email needed (§5).
- **Invited:** a tree keeper shows you a QR code, or sends you a link on WhatsApp. It opens **"Is this you?"** with your place on the tree and your close family's first names → **Yes, that's me** → create an account → **Take my place**. Your household is named after you ("Nia's household"). Not you? **not me** → **Cancel this invite**.
- **Who's looking?** A shared household login asks who's looking (Netflix-style), because nicknames belong to the person, not the login.
- **Demo:** pick a household, then yourself — *Aizat & Sarah's household* has the most to see.

## 3. What works (all of the spec)

| Feature | Where |
|---|---|
| **Per-viewer nicknames** | tap any person → "You call them" — saves instantly and relabels their node on *your* tree only. "Also known as" shows what everyone else calls them. Switch profiles (top chip) to see the whole tree relabel. |
| **Per-household tree name** | "BearFamily" in the top bar is *your household's* name for the tree — ✎ to rename (on a phone: **⋯** → Rename your tree). Kak Ina's login calls the same tree "my family". |
| **Your household always in view** | you + partner + kids never get parked by focus mode; only their own ⊖ hides them. |
| **Expand / focus** | ⊕ pills grow a side (with people-count). **One side per couple** is the only auto-collapse: expanding upward parks your partner's side; opening Granny's side parks Atok's — two sibling fans can't share one couple. **Downward expansions never collapse**: open every aunt's and uncle's family at once and explore the whole tree. Focus bar top-left; "back to my view" resets. |
| **Map navigation** | drag to pan, scroll wheel zooms at cursor, pinch on touch, −/+ buttons (desktop), **◎ me** recentres, minimap bottom-right (click to jump), search flies to anyone (auto-expands the path to them). On a phone the top bar is one row — 🐻, search, who you're viewing as, ◎ and **⋯** (Help, tutorial, tree keeper settings, rename). |
| **Node interactions** | **hover or single-click** a person → a floating **＋** appears (quick add-relative). **Double-click** opens their full sheet (view/edit). Click empty canvas to dismiss the ＋. |
| **Your own name** | your sheet has a **"You go by"** field — the name shown big on your own node (separate from your full name and from what others call you). |
| **Living-in flags** | flag pip top-right of each node; set in the person sheet. |
| **Passed relatives** | behind **+ more** in the person sheet (never face-up): a date (YYYY or YYYY-MM-DD, or type `unknown`) + "Shown as" phrasing dropdown grouped by tradition (Islam / Christian / Chinese / Generic / Custom). Node greys out, photo goes greyscale, flag disappears, memorial line appears. |
| **3 photos per person** | person sheet → young kid / teen · young adult / adult slots. ★ picks which one shows on the tree. Photos are auto-downscaled. |
| **Claim & 5-branch editing** | anyone can add a person (starts *unverified*); profiles are editable within **5 branches** until claimed; claimed profiles lock to their household — except memorial phrasing, which stays family-stewarded. The sheet tells you why something is view-only. |
| **Add relatives** | "Add relative" on any sheet — Parent / Partner / Child / Sibling, anchored so nobody floats. |
| **Name not known yet** | leave the name **empty** (or type **?** or **-**) when adding them (e.g. a married-in spouse, so the children can hang under the couple). The tree shows them as **"Pak Long's wife"** (the partner in each viewer's own words), or — with no partner — where they hang: **"Daughter of Aizat & Sarah"** / **"Son of …"** / **"Child of …"**, **"Mother/Father/Parent of …"**; "Name not known yet" only when they're linked to nobody. That label is their name on the tree, on their card and in search, with *name not known yet* underneath, inside a **dashed circle** — a gap waiting for its name. Search finds them by that label. Their card asks anyone who can edit to **add their name**; ⭐ Tree keeper settings lists every one under **Names to fill in** — tap a row, type the name, Save. Nothing gets relinked. Clearing someone's name on their card asks first, then makes them "name not known yet". An invite for them uses the same label but never an "only us" nickname ("Daughter of Aizat & Sarah", not "… & Sayang"). Seeded: Pak Long's wife. |
| **Ordering rules** | siblings sit **oldest → youngest, left → right** (by the Born field — fill it in for correct order). Couples sit **husband left · wife right** (by the Gender field, under "+ more"); any couple can override with the **Couple side** field — set one partner to left or right and it wins, so every couple chooses their own arrangement. |
| **Stable positions** | expanding a side never reshuffles what's already on screen — new people slot in around the existing layout, and the node you expanded stays put under your cursor. |
| **Children card & fixing links** | every sheet lists the person's children. If their partner has children not linked to them (added before the marriage was), each shows **"link as X's child"** — one tap attaches the parent. |
| **Deleting someone** | open their sheet → **"remove [name] from the tree"** at the bottom (only on profiles you can edit; never yourself). Their links go too; children keep their other parent. |
| **Dating** | Partners card → status **dating**: the couple stands together joined by two blue slashes **∕∕** instead of a line. |
| **Separations & divorce** | every person sheet has a **Partners** card: set a link to *separated* or *divorced* (+ year) and the couple line breaks with a **⫽ divorce mark and a blue "divorced · 2010" badge** — obvious at a glance. **Unlink** removes the link entirely: both people stay, children keep both parents, and an ex with no other connection drops off the canvas. |
| **Remarriage** | the current partner pairs solidly; the ex stays on the other side with the broken line, and shared children keep hanging under the *old* partnership — never under the new partner. See it seeded on Kamal (Granny's brother): Roslinda ⫽ Kamal — Aminah, with Hafiz below. **Married-in exes fade to 70% opacity** — still around, visibly no longer core family (different from deceased, which is greyscale + memorial line; exes keep colour and flag). |
| **Multiple concurrent marriages** | supported — the earliest marriage pairs; each additional current partner stands on the outer side with a solid line (no break, no fade), their children under them. |
| **Step-children** | "Add relative → Child of [name] **only**" links a child to one parent — their line drops from that parent alone, never the couple midpoint. Seeded: Iman (Aminah's son from her first marriage) hangs from Aminah, beside Hafiz who hangs from Kamal–Roslinda. |
| **Animation** | expanding/collapsing is animated: new people grow out of the node you tapped, collapsed ones retreat back into it, and the connecting lines fade in once everyone has settled. **The camera anchors to your household** — it never moves when you expand, anywhere in the tree; deep blocks drift to make room instead. Honours reduced-motion settings. |
| **What an expansion shows** | a side-expansion brings parents + siblings **+ the siblings' current partners** automatically; children stay behind each couple's ⊕ family chip. Exception: **your own siblings' families (nieces & nephews) are visible by default**, with a ⊖ to fold them. |

## 4. Files in this folder

- `app/index.html` — the whole app (single file, no build step)
- `supabase/migrations/` — the full database history (schema + Row-Level-Security + every upgrade), applied with `supabase db push` — never edited once on `main` (README, "Database change rules")
- `tests/` — the checks every pull request runs (`permissions.mjs`, `smoke.mjs`, `migration-rules.sh`, `ci-stack.sh`)
- `RUNBOOK.md` — what to do when… (Aizat's plain-steps guide)
- `family-tree-concept.md` — the product spec (data model, RLS design, interaction rules)
- `wireframe.html` — the annotated wireframe it was built from
- `INSTRUCTIONS.md` — this file

## 5. The real tree (Supabase)

The app is wired to the live Supabase project (`garbnserzkuazmvonfem`, Free plan). The Supabase key in the app is the *publishable* key — safe to be public; every read and write is enforced by the Row-Level-Security rules in the database, not by secrecy.

**No emails, ever.** "Confirm email" is off (Supabase Dashboard → Authentication → Sign In / Providers → Email), so a new account goes straight in, and the app never sends mail.

**Tree keepers (⭐), up to 3 per tree.** The household that starts a tree is its first keeper; ⭐ **Tree keeper settings** (top bar on a computer, **⋯** on a phone) lists every household **with the people in it** and lets a keeper **make keeper** / remove one. Keepers can edit everyone on the tree, invite relatives, make reset codes, and see **Invites so far** (numbers only: made, opened, joined, "not me"). Help lists who the keepers are, so relatives know whom to ask.

**Households** are named after their first member ("Nia's household") — nobody has to invent a name when joining or starting a tree. A household's own name for the tree starts as the keepers' name for it; ✎ renames it for that household only.

**Inviting a relative (keepers only) — by QR code or WhatsApp:**
1. Open the *unclaimed* person's card → **✉ invite [name] to claim this profile**. (Not shown for someone with a memorial.)
   - **📷 With you now? Let them scan this** — a big QR code. It must be **scanned within 5 minutes** (a countdown shows "works for 4:59"); once scanned they have **10 minutes** to finish signing up. Your screen says "✓ scanned — … has 10 minutes to finish signing up, until 2:59 pm", then "🎉 … has taken their place", or "🚫 … said this isn't them". Refresh makes a brand-new code; closing the sheet deletes a code nobody scanned.
   - **💬 Not with you? Send a link** — **make a 14-day link**, then **💬 WhatsApp** (pick the person — the app holds no phone numbers) or **copy link**. Single use, 14 days.
2. **The rule until a keeper "confirm" step exists:** whoever signs up with a code or link takes the place straight away, so show the QR face to face and send links **to that one person only — never to a group, never at a gathering or on a shared screen.** If it reaches the wrong person, they tap **not me** → **Cancel this invite**: it stops working at once and keepers see it next time they open the app.
3. **General code:** ⭐ Tree keeper settings → *Invites* → **✉ create** — anyone with it can join (14 days) and then claim/add themselves; send it to one person at a time. Once someone has joined with it, it can be **stopped** but not deleted.

Used invites are kept as a record (who joined, when, by QR / link / code) instead of being deleted.

**A forgotten password:** a keeper opens the relative's card → **🔑 help … back in** (the question names the household and who is in it) → a one-time code (8 characters, 30 minutes) → WhatsApp it to them. They tap **Forgot your password?**, type the code and a new password — the code alone finds their login, and the app shows them which email it uses. On their other phones they're told "your password was reset by a tree keeper from <household> on <date>", and their card shows the last reset. Limits: 5 wrong tries burn a code; 20 wrong codes in half an hour pause all resets for 30 minutes; at most 3 codes waiting per tree.

**A friend's own tree:** keepers only — your own card → **Invite a friend to start their own tree** → **✉ share**: a one-time start-a-tree link (`…#newtree=<code>`, 14 days). They create an account and start a completely separate tree as its first keeper; trees never see each other. One tree per login, up to 5,000 people per tree.

**Tutorial:** every account walks through a 3-step tutorial on first entry; reopen it any time from **🎓** (on a phone: **⋯** → Tutorial).

**Syncing:** every edit writes through to the cloud instantly; screens refresh whenever a window regains focus. For live push (~1s) updates, run `supabase/enable-realtime.sql` once in the SQL Editor — optional.

## 6. Known limits

- **Photos** are stored inside the database rows (fine for a few dozen); moving them to file storage is planned before photos are encouraged or shown on a TV.
- **No keeper "confirm" for QR codes yet** — face to face, one person at a time (§5). Needed before any gathering.
- Layout is auto-computed each time; with very wide expansions lines can occasionally cross — pan/zoom or focus mode keeps it readable.
- "Sign out" is on your own profile sheet (tap your node).
- The demo's data lives in that browser only (about 5 MB, photos included); clearing the browser's site data resets it to the demo family.
