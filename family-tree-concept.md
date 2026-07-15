# Bear Family Tree — Concept & Wireframe Notes

> Follows **Aizat's Personal Design System v2** (soft minimal, Poppins, `#004A98` + `#B4CEFF`, white cards on `#F7F9FC`, pill buttons, bear mascot).
> Companion file: `wireframe.html` — open it in a browser to see the annotated screens.

---

## 1. The idea

An editable family tree for a big family. Every family member signs in as themselves, sees the tree **centred on their own direct family**, and can expand outward — up a generation, sideways to aunts/uncles/cousins — as far as they want.

The signature feature is **per-viewer nicknames**:

- Everyone has one **full name** (canonical, shared by all viewers).
- Each viewer can set **their own nickname** for any person — that's the name *they* see on the tree. Aizat's daughters see "Atok" and "Granny"; a cousin sees "Pak Cik" and "Mak Ngah" on the very same two people.
- On your **own profile**, you can see every nickname others have set for you ("what people call me") — a warm little mirror of your place in the family.

## 2. Core jobs (priority order)

1. **Browse the tree** — direct family first, expand to extended family on either parent's side, and further.
2. **Personalise** — set my nickname for each person; see what others call me.
3. **Edit** — add people, edit details, add a photo, connect relationships.

## 3. Data model (sketch)

| Entity | Fields |
|---|---|
| **Person** | id, full name, photo, born (date), **living-in country** (shown as a flag at the node's top-right), notes, **passed_on (date, null = alive)** — one field defines alive vs passed, no separate flag to fall out of sync, `claimed_by → nucleus` (null = **unverified**) |
| **Memorial** | person_id, phrase style — how the passing line reads, chosen from grouped presets or custom text. **Editable by anyone within 5 branches, claimed or not** (the departed can't steward their own profile; nearby family does) |
| **Relationship** | person A ↔ person B, type: `partner` / `parent-child`. Partner links carry a **status** — `together` (default) / `separated` / `divorced` — and an optional end year |
| **Nickname** | person (who it's about), viewer-person (who set it), text — unique per (person, viewer) |
| **Nucleus** | the login unit: one household (husband + wife + kids) *or* one single person — each part of the family chooses for themselves. Holds **`tree_name`** — what the whole tree is called *for them*: "BearFamily" for Aizat's nucleus, "my family" for his sister, "FAM" for a cousin |
| **Account** | auth login → nucleus. A shared nucleus login opens a **profile picker** ("viewing as…", Netflix-style), so nicknames stay per *person* even behind a shared login |

Display-name resolution, in order: my nickname for them → their full name.
My own node always shows "you". **My nucleus is always in view** — the focus accordion never parks it; only I can minimise it, explicitly.

## 4. Screens (see wireframe.html)

1. **Tree — direct family (default)**
   App bar: bear tile + title, search, "viewing as" chip, zoom controls.
   Canvas: 3 generations centred on the viewer — **your** parents and siblings, **your siblings' partners and children (nieces & nephews, shown automatically with a ⊖ to fold them)**, viewer + partner, children; the partner's side sits behind its ⊕ chip (one side per couple, §7). Every edge person carries a small **⊕ expand** pill (with a count). A side-expansion brings parents + siblings **+ the siblings' current partners**; only children need a further ⊕ family tap.

2. **Tree — expanded (one side)**
   Tapping ⊕ on a parent grows the canvas upward/outward: grandparents appear above, great-uncles/aunts beside, each with their own collapsed "⊕ family · n" chips. The page pans (drag / scroll); a **minimap** appears bottom-right once the tree exceeds the viewport. Collapse with ⊖ on the same node.

3. **Person sheet** (tap any node → bottom sheet)
   Photo, full name, relationship-to-you caption, facts.
   - **"You call her"** card — my nickname, one tap to edit (input + save).
   - **"Also known as"** card — read-only list of nicknames others set, with who uses each.
   - Actions: Edit details · Add relative.

4. **Add / edit person sheet**
   Photo upload tile, full name, born, **living-in country** (drives the node flag). Everything else sits behind a **"+ more" tertiary disclosure** (the BearHaus "+ details" pattern): notes, and the **"Passed on" date + "Shown as" phrasing dropdown** (grouped presets, §5). Passing is deliberately never a face-up form field — you only see it when you go looking. Leaving the date empty is what "alive" means; filling it greys the node out.
   Relationship picker as choice rows: *Parent of… / Partner of… / Child of… / Sibling of…* (anchored to the node you launched from).

5. **My profile — "what people call me"**
   My photo + full name, then the full list of nicknames others have set for me. My own nickname edits happen on *their* profiles, so this screen is read-only + a gentle explainer.

## 5. Design-system notes specific to this app

- **Nodes:** 64px circular photo (accent-soft placeholder with initials when no photo), nickname in Label 13/500 ink, full name in Caption ink-soft below. A small **country flag** (where they live now) sits top-right of the circle on a white pip. The viewer's node gets the primary ring + halo + "you" chip.
- **Passed relatives** (when `passed_on` is set): the node greys out softly — photo rendered **greyscale** (CSS `filter: grayscale(1)`, slightly lowered opacity), the flag pip disappears, nickname drops to ink-soft, and a small **memorial line** sits under the name. Calm and factual, never black-bordered or somber-styled — the design system's no-alarm rule applies to grief too.
- **Memorial phrasing is per person** — a dropdown of presets grouped by tradition, each with a with-date and a without-date form (dates can be full, year-only, or unknown):
  - *Islam:* "Returned to Allah on [date]" · "Returned to Allah" · "Allahyarham / Allahyarhamah"
  - *Christian:* "Went home to the Lord on [date]" · "At rest in Christ" · "In loving memory"
  - *Chinese traditions:* "安息 · at rest · [date]" · "往生 on [date]" (Buddhist)
  - *Generic:* "Passed on [date]" · "Passed in [year]" · "Passed" · "Rest in peace"
  - *Custom:* free text with an optional `[date]` token, for anything the family's tradition calls for.
  The phrasing (this field only) is editable by **anyone within 5 branches, even on claimed profiles** — see §6. In every editor the passed-on fields hide behind **"+ more"** — never shown by default.
- **Couple link:** hairline between partners with a small primary dot at the midpoint; children hang off that midpoint.
- **Connectors:** 1.5px lines in `#E6E5E5` — depth stays whispered; the people are the content.
- **Expand pills:** secondary-button style (`#E4EEFF` bg, primary text) with a count, so cost of expanding is visible before tapping.
- **No red/green anywhere** — deceased is a small caption ("1938–2021"), never alarm styling.
- Mobile: same canvas, pinch-zoom + drag; sheets already mobile-first per the system.

## 6. Sharing & security — Supabase RLS design

One extended-family **tree** is the tenant (the whole graph everyone shares). The login unit inside it is the **nucleus** — a household sharing one login, or a single person with their own; each part of the family chooses. "BearFamily" is not the tree's name — it's **`nucleus.tree_name`**, so Aizat's household sees "BearFamily", his sister sees "my family", a cousin sees "FAM", all on the same tree.

### Tables

```sql
tree          (id, created_at)                      -- the tenant: one extended family graph
nucleus       (id, tree_id, tree_name text default 'our family')
account       (user_id → auth.users, nucleus_id)    -- shared or individual login
person        (id, tree_id, full_name, photo_url, born date,
               living_country char(2),               -- ISO code → flag on the node
               notes,
               passed_on date null,                  -- null = alive; set = greyed node,
                                                     -- greyscale photo, "Passed on …"
               claimed_by → nucleus null)            -- null = unverified
memorial      (person_id pk, tree_id, style_id → memorial_style, custom_text null)
memorial_style(id, group_name,                    -- 'Islam' | 'Christian' | 'Chinese' | 'Generic'
               with_date_template,                -- e.g. 'Returned to Allah on [date]'
               without_date_template)             -- e.g. 'Returned to Allah'
relationship  (id, tree_id, person_a, person_b, kind 'partner'|'parent-child')
nickname      (id, tree_id, person_id, viewer_person_id, text,
               unique (person_id, viewer_person_id)) -- viewer must belong to your nucleus
kinship       (tree_id, person_a, person_b, hops)    -- materialised graph distance (see below)
tree_invite   (tree_id, code, created_by, expires_at)
```

Every row carries `tree_id` — the tenant key all policies hang off. `kinship` is a closure table maintained by trigger whenever a relationship row changes: every pair of connected people and the number of **branches** (partner or parent-child hops) between them.

### Helpers, security definer (avoid recursive RLS)

```sql
my_nucleus()            -- nucleus_id for auth.uid(), from account
in_tree(t uuid)         -- does my nucleus belong to tree t?
branch_distance(p uuid) -- min hops between person p and any *claimed* member
                        -- of my nucleus, read from kinship; null if unconnected
```

### Policies per table

| Table | select | insert / update | delete |
|---|---|---|---|
| `nucleus` | `in_tree(tree_id)` | update **only `id = my_nucleus()`** — you rename *your* view of the tree, never anyone else's | own nucleus |
| `person` | `in_tree(tree_id)` — everyone can **view** the whole tree | **claimed:** only `claimed_by = my_nucleus()`. **Unclaimed:** anyone with `branch_distance(id) <= 5`; beyond 5 branches you're view-only | soft-delete only, same rule as update |
| `relationship` | `in_tree(tree_id)` | allowed if you may edit **either** endpoint under the person rule | same |
| `memorial` | `in_tree(tree_id)` | **`branch_distance(person_id) <= 5` — claimed or not.** The one deliberate exception to the claim lock: the departed can't steward their own memorial line, so nearby family always can | same |
| `memorial_style` | everyone | seeded presets; tree admins may add | — |
| `nickname` | `in_tree(tree_id)` | **`viewer_person_id` must belong to `my_nucleus()`** — you write only your own nicknames | same |
| `account` | own row | via RPCs only | yourself (leave) |

### The claim system (verification)

- **Anyone can add a person** — a new `person` row starts with `claimed_by = null` → **unverified** (a quiet backend flag, not a badge of shame in the UI). Most of the family may never log in, and that's fine; their profiles still exist and are cared for by relatives nearby in the graph.
- **While unclaimed**, the profile is community-editable — but only by people **within 5 branches** (`branch_distance <= 5`, counting each partner or parent-child link as one branch). Distant relatives can view, not edit. That keeps stewardship local: your nephew can fix his mum's photo; a third cousin's in-law cannot.
- **Claiming:** an RPC `claim_person(person_id)` lets a login say "this is me / this is in my nucleus" (e.g. parents claim their kids). Once claimed, **only that nucleus can edit it** — everyone else becomes view-only. Conflicting claims are rare in a real family; resolve with a simple "already claimed by X — talk to them" message + tree-admin override.
- `branch_distance` measures from your nucleus's **claimed** people, so claiming is also what anchors your editing reach.

### Joining a tree

No public signup. Any member generates an invite code (`tree_invite`); the newcomer signs up, calls `join_tree(code)` (security definer), picks or creates their nucleus, then **claims their own person node** (or gets created fresh). Photos live in a storage bucket with a mirror policy: path prefix = `tree_id`, checked with `in_tree()`.

## 7. Tree interaction model

### The "you" node
Must be findable at a glance even in a 100-person tree with photos everywhere: 3px solid primary ring + a soft powder-blue **halo** (9px glow) + elevated shadow + "you" chip. The halo sits *outside* the photo, so a real photo never swallows it. A "centre on me" button in the app bar always flies the canvas home.

### Focus expand ("explore Granny's side")
Expanding is an **accordion, one side at a time**:

1. Tap **⊕ Granny's side** → her parents slide in above, her siblings beside, each sibling with its own collapsed `⊕ family · n` chip — keep tapping to go as deep as you like (cousins, their kids, …).
2. **One side per couple, always** — the hard rule that keeps the canvas honest. At every couple, only one partner's blood-side can be expanded at a time: expanding upward from your nucleus parks your partner's side; exploring Granny's side keeps Atok's side behind its ⊕ chip; and the same at every level. *Why it must be a hard rule:* if Atok is the 5th of 8 children and Granny the 3rd of 6, both sibling fans need the same space around the couple — there is no clean way to draw both at once, at any generation. So the tree never tries; the other side is always one tap away.
3. **Your nucleus (you, your partner, your kids) is always in view** — the accordion never parks it; only an explicit tap on its own ⊖ can minimise it.
4. A **focus bar** appears top-left: `focused: Granny's side · back to my view` — one tap returns to your default view (you + your own parents & siblings; your partner's side behind its chip). There is deliberately **no "show all"** — a filled-out tree shown all at once is unreadable by construction.
4. ⊖ on the node you expanded collapses that side again.

### Separations, divorce & changed partners
Families change; the tree offers both of the honest options:

1. **Keep them, marked** — set the partner link's status to *separated* or *divorced* (+ optional year). The line **breaks in the middle with the genealogical ⫽ divorce mark**, both halves dashed, and a **powder-blue chip badge** sits on the line ("divorced · 2010") — unmistakable at a glance, still no red, no drama. While they share children on screen, the pair still sits together so the kids hang properly; an ex with no shared children on screen stands apart (or drops off the canvas if nothing else connects them).
   **Remarriage:** the new partner pairs solidly beside them; the ex settles on their *outer* side with the broken line, and shared children keep hanging under the *old* partnership's midpoint — never under the new partner. (Layout: Roslinda ⫽┄ Kamal ——— Aminah, with Hafiz below the Kamal–Roslinda gap.)
   **Married-in exes fade to 70% opacity** (30% transparent) — someone on the canvas *only* through an ended partnership (no blood family of their own shown, no current partner) reads as "still around, no longer core family". Blood relatives never fade, and the fade lifts the moment they remarry into the tree. Distinct from deceased on purpose: deceased = greyscale + no flag + memorial line (colour drained); an ex keeps full colour and flag, just lighter.
   **Multiple concurrent marriages** (never divorced): supported — the *earliest* marriage pairs on the tree; each additional current partner stands on the outer side with a **solid** line and dot (no break, no badge, no fade), their children hanging under them. (Layout: Aminah ——— Kamal ——— Roslinda.)
   **Step-children** (a partner brings children from a previous relationship): supported — a child is linked to their actual parents only, so a step-child's line drops from **their own parent alone**, never from the couple's midpoint. Adding one uses "Add relative → Child of [name] *only*" (offered whenever the anchor has a partner). If the other biological parent is added later, the child re-anchors to that partnership automatically. Demo: Iman hangs from Aminah alone, beside Hafiz who hangs from the Kamal–Roslinda line.
2. **Remove them entirely** — "unlink" deletes just the partner link. Both people remain in the data, children keep both parents; an ex connected by nothing else simply disappears from the canvas (still findable in search).

Editing a partnership follows the reach of **either** endpoint (claimed-by-you or ≤5 branches), since it belongs to both people. Remarriage is just a new partner link — the current partner pairs on the tree, exes show per rule 1.

### Navigation — a map, not a page
Family trees grow sideways; a normal page scroll fights that. So the canvas behaves like Google Maps / Figma, not like a document:

- **Click & drag anywhere to pan** in any direction (grab cursor; touch: one-finger drag).
- **Scroll wheel = zoom at the cursor** (the Figma/Miro convention). This single choice solves the up/down-wheel problem — the wheel stops meaning "vertical" at all. Trackpads two-finger-pan in both axes natively; pinch zooms.
- Fallbacks that also work: `shift + scroll` pans sideways, arrow keys nudge, `+/−` buttons zoom.
- **Minimap** (auto-appears when the tree outgrows the viewport) — drag the little viewport rectangle to jump anywhere.
- **Search and "centre on me"** fly the canvas to a person — nobody should ever *scroll* to find someone.
- Layout keeps generations as horizontal rows (wide, not tall) — with focus-accordion + zoom, width stays manageable.

## 8. Later (out of wireframe scope)

- Auth: household-style login per family member (Supabase, like BearHaus).
- Realtime sync so edits appear for everyone.
- Photo storage + cropping.
- Search that jumps/centres the canvas on the match.
- Export (image / PDF) of any subtree.

*July 2026 — wireframe v1.*
