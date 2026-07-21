# Ideas backlog 🐻

> List mode: ideas accumulate here with design notes; when the list is ready, we build the batch in one go. Nothing here is built yet.

## 1 · Gender display on nodes — ⏳ awaiting Aizat's pick (mockups done)
Show man/woman visually on every node:
- **No photo** → colour treatment on the avatar
- **With photo** → tinted background shadow/glow behind the photo
Two mockup options prepared (see `mockups/gender-display.html`):
- **Option A — Soft fill & glow:** no-photo avatars filled powder-blue (man) / soft-rose (woman); photos get a tinted ambient glow.
- **Option B — Ring & glow:** avatars stay neutral; a slim tinted ring circles everyone, photos add the glow. More uniform across states.
Notes: palette stays desaturated per the design system (no candy pink/blue); people with no gender set stay exactly as today; deceased greyscale wins over gender tint.

## 2 · Manual sibling ordering — 📥 logged
Most siblings have no birth year, so age-ordering can't place them. Add a manual position that beats the birth-year sort:
- proposed: `sib_order` field on person (small int, optional); sheet gets ← / → "move among siblings" controls (or drag on desktop); sort = sib_order first, then born, then name
- needs one DB migration + layout sort tweak + sheet UI
