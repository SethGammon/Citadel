# Citadel application-readiness visual QA triage

Initial findings were observed against the deployed GitHub Pages site on
2026-08-01 before application-readiness edits. This file now records their
local release-candidate disposition; hosted verification remains post-merge.

## P0

- None. The homepage opens at scroll position zero, leaves focus on `BODY`, and has no horizontal overflow at 1280px or 390px.

## Resolved visual grade findings (2026-08-01)

- **P1 color:** the shared field, section, panel, border, supporting-copy, and
  social-preview palette now uses visibly chromatic ink, ocean, cyan, blue, and
  violet values. The final computed-style audit found no visible leaf text below
  the low-saturation threshold used for the initial diagnosis.
- **P1 reveal safety:** `.site-reveal` is visible in its base state and only uses
  a small transform for enhancement. The final matrix found zero hidden reveals.
- **P1 hover clearance:** `.generators` now exposes overflow and reserves 6px of
  top movement space. A transformed generator tile was captured at desktop and
  mobile widths without clipping.
- **P2 depth:** page, section, card, nested-control, and media planes now have
  distinct chromatic gradients, colored shadows, and inset highlights.
- **P2 screenful rhythm:** responsive section spacing was tightened and Research
  changes layout before its comparison values can force overflow. The actual
  39px Research overflow at 1024px was fixed.
- **P2 typography:** the sans/mono role split remains intact while supporting
  text, captions, controls, and measurements use brighter blue-white values.

The final pass covered the homepage, Evidence, Operation Control, Optimizer,
Research, and Walkthrough at 1440 by 900, 1024 by 768, and 390 by 844: 18 page
and viewport combinations with zero horizontal overflow and zero invisible
reveals. Both walkthrough videos reached ready state 4 at 1920 by 1080; their
durations remain 120 and 42 seconds.

## Resolved P1

- Research, Optimizer, and Evidence now publish v1, v2, and the representative
  v3 shakedown with exact result and claim boundaries.
- `evidence.html` is the evaluator index; `walkthrough.html` adds a two-minute
  narrative and a real-command verification supplement.
- All public pages now carry canonical, Open Graph, Twitter, manifest, sitemap,
  and shared social-preview metadata.
- The homepage preserves its historical 120-cell integrity strip and adds a
  separate 168-cell prospective proof card, avoiding denominator conflation.

## Resolved P2

- Three deliberately framed 1440 by 900 application images replace full-page
  captures; the comparison image contains all three studies and no next-section
  crop.
- Optimizer and Research lead with the failed result and exact boundary.
- Shared navigation exposes Evidence while the homepage still starts at `/do`.
- The hosted smoke workflow binds deployed pages to the release-manifest source
  digest and checks focus, overflow, titles, proof copy, and console errors at
  desktop and mobile widths.

## Acceptance targets

- `/do` remains the first and dominant homepage story.
- A new Evidence page gives a reviewer a two-minute path through claims, receipts, boundaries, reproduction commands, onboarding proof, and grant milestones.
- Research and Optimizer pages state both the v1 outcome and the new v2 outcome exactly as signed.
- All public pages have canonical, description, Open Graph, and Twitter metadata plus a shared social image.
- Local desktop, tablet, and 390px browser checks pass, including no horizontal overflow,
  dialog focus restore, tab arrow navigation, caption binding, and both videos
  reaching ready state 4. Hosted checks remain the post-merge gate.
