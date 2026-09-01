# Strata Compute — brand package

## The mark

`mark.svg` (dark theme) and `mark-light.svg`. Chosen from the fifteen
candidates; the other fourteen are gone.

A monogram built only from beds — three horizontal layers and two verticals,
no letterform imported from a typeface. It says the name twice over: the S is
the initial, and the layers are what *strata* means.

## The X package

```
x-header.png            1500×500   profile header
x-avatar.png             400×400   avatar, mark on the brand ground
x-avatar-lime.png        400×400   avatar, mark knocked out of the accent
x-preview.png                      the pair mocked up as a finished profile
x-header-safe-area.png             the reserved zones drawn on the header
build-x-package.mjs                rebuilds all of it
```

Rebuild with `node logoreferensi/build-x-package.mjs`.

### The header

The accent rule runs the full width and the lockup sits on it, carrying its
own ground so the rule appears to pass behind rather than through. That break
is the whole composition, which is why it is a single line and not a band —
the two grey plates that were behind it have been removed.

Line: *Stocks, crypto, onchain — measured the same way.* Not a slogan written
for the picture; it is what the engine does, and the site says the same thing
in its own description.

Two constraints shape it, and they are why this is not a share card stretched
wide:

1. **The avatar covers the bottom-left corner** — roughly a 260px circle
   straddling the bottom edge near the left. Anything placed there is hidden
   permanently, so the composition is centred and that corner is empty.
2. **Narrow viewports crop top and bottom**, so nothing that matters goes near
   either edge. The rule sits on the centre line.

`x-header-safe-area.png` draws both zones, and `x-preview.png` mocks the
finished profile, so the pair can be judged together rather than one file at a
time — that is where a header which ignores the avatar gets found out.

### The avatars

Square files, but X renders them as circles, so the mark is set well inside
the inscribed circle instead of filling the plate. Two options: the dark one
matches the header and is the safer pick; the lime one is louder and reads
further down a timeline.

### Still empty: the share card

Different slot, different size. `app/layout.tsx` declares `openGraph` and
`twitter: { card: "summary_large_image" }` but ships no image, so a shared
link to stratacompute.app still renders as a bare text card. That one wants
1200×630 at `app/opengraph-image.png` — not what these files are.

## Colour

From `app/globals.css`. The accent is `--strata-green-ink`, which is
deliberately not the same value in both themes:

```
          dark        light
ink       #f2f5f3     #101311
accent    #ccff00     #627a00
recessive #5b635e     #949d97
ground    #080a09     #ffffff
```

## Installing the mark

Not done yet — the app still shows the old diamond. Two files:

- `components/layout/logo.tsx` — replace the paths in `LogoMark` with the five
  rects from `mark.svg`, swapping `#f2f5f3` for `currentColor` and `#ccff00`
  for `var(--color-green-ink)`. That one substitution is what makes the light
  variant fall out for free.
- `app/icon.svg` — the favicon, which needs literal hex rather than CSS
  variables, so paste `mark.svg` unchanged.
