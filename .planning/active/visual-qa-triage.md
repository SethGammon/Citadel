# Citadel application-readiness visual QA triage

## Final whole-site pass - 2026-08-03

### Summary

- 373 overlapping viewport screenshots reviewed across 7 public pages and 5
  viewport classes.
- 5 actionable findings: 1 broken, 1 ugly, 3 polish; all resolved.
- All other page and viewport combinations retained their current composition.

### BROKEN

#### [SITE-B1] Research hero metrics overflow at 320px

- **Screenshots:** `output/playwright/site-visual-audit/before/research/small-mobile/`
- **Expected:** the two-column proof strip remains inside the 320px viewport.
- **Actual:** the right-hand metrics reach 361px inside a 320px viewport.
- **Root cause:** shared proof-page components inherited content-box sizing, so
  column padding expanded each nominal grid track beyond its allocation.
- **Resolution:** border-box sizing and minimum-width containment are now an
  explicit shared site-page contract. The 320px document is exactly 320px wide.

### UGLY

#### [SITE-U1] Walkthrough transcript becomes a long wall of prose

- **Screenshots:** `walkthrough--tablet.png`, `walkthrough--mobile.png`, and
  `walkthrough--small-mobile.png` contact sheets.
- **Expected:** the media remains primary and the complete accessible transcript
  unfolds when a visitor asks for it.
- **Actual:** four long paragraphs occupy the final two to five screenfuls; at
  768px the two-column layout also leaves an unnecessarily narrow reading rail.
- **Root cause:** the full transcript is permanently expanded and the layout
  does not collapse until 760px.
- **Resolution:** retained a visible plain-language introduction and download,
  then place the complete transcript in a styled native disclosure. Collapse
  the grid before tablet reading becomes cramped.

### POLISH

#### [SITE-P1] Homepage suppresses the shared custom scrollbar

- **Screenshot:** all Homepage captures.
- **Expected:** long-form product storytelling uses the same thin cyan-to-blue
  scrollbar as the rest of the public site.
- **Actual:** legacy homepage CSS hides scrollbars in Firefox and Chromium.
- **Root cause:** the original single-screen prototype used an intentionally
  hidden scrollbar before the page became a native long-form story.
- **Resolution:** removed the legacy hide rule and let the shared site system
  own scrollbar appearance.

#### [SITE-P2] Homepage ambient motion persists beyond its purpose

- **Expected:** the interactive field adds life to the product entry, respects
  reduced motion, and recedes while the visitor reads later proof sections.
- **Actual:** the canvas requests frames at 60fps and autonomous pulses continue
  throughout the entire long-form page.
- **Root cause:** animation behavior remained tuned for the original single
  viewport prototype.
- **Resolution:** capped the canvas at 30fps, rendered only once for reduced-motion
  visitors, confine autonomous pulses to the hero viewport, and run the five
  routing animations only while their explanatory section is visible.

#### [SITE-P3] Research closing actions read as one run-on link cluster

- **Expected:** the four next steps are distinct, touch-safe actions with a
  clear primary choice.
- **Actual:** incomplete `.button` styling leaves inline anchors touching and
  wrapping like prose at tablet and mobile widths.
- **Root cause:** the proof-page button skin supplied colors without supplying
  a complete layout and spacing contract.
- **Resolution:** completed the button component and gave the action group a
  wrapping gap, switching to full-width actions on the narrowest viewport.

### Reviewed screenshot matrix

- [x] Homepage: desktop, laptop, tablet, mobile, small mobile
- [x] Evidence: desktop, laptop, tablet, mobile, small mobile
- [x] Operation Control: desktop, laptop, tablet, mobile, small mobile
- [x] Optimizer: desktop, laptop, tablet, mobile, small mobile
- [x] Research: desktop, laptop, tablet, mobile, small mobile
- [x] Walkthrough: desktop, laptop, tablet, mobile, small mobile
- [x] 404: desktop, laptop, tablet, mobile, small mobile

### Preserved strengths

- `/do` remains the dominant first-use story and the four levels remain clear.
- Evidence-heavy pages are dense but structured, readable, and candid.
- Sticky navigation does not cover section starts or clip transformed controls.
- The palette, typography roles, card depth, and proof hierarchy remain coherent.
- Reduced-motion captures report zero active animations on every tested page.

### Final verification

- [x] 361 fresh after-state viewport screenshots across the same 7 pages and 5
  viewport classes; the count fell from 373 because the transcript now unfolds
  on request rather than consuming twelve extra overlapping captures.
- [x] 35/35 runtime combinations: zero overflow, local console errors, missing
  focus outlines, or failed mobile-menu/disclosure interactions.
- [x] 14/14 reduced-motion combinations: zero active animations and zero hidden
  reveal content.
- [x] Public story contract: 44/44.
- [x] Grant verification: 17/17.
- [x] Full repository test suite: all tests passed.
- [ ] Hosted post-merge smoke and deployment digest verification.

---

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

---

# Sentient grant PDF legibility triage - 2026-08-01

## Summary

- 7 issues found and resolved: 2 broken, 3 ugly, 2 polish; 0 open.
- Area affected: all eight pages of the supporting PDF.
- Screenshots reviewed: 8/8 freshly rendered at 96 DPI under
  `tmp/pdfs/before/`.

## BROKEN

### [PDF-B1] Required supporting copy is too small and too low contrast

- **Screenshots:** `tmp/pdfs/before/page-1.png` through `page-8.png`
- **Expected:** body copy, evidence labels, table values, and URLs remain
  comfortably readable at normal PDF-viewer scale.
- **Actual:** 6.8-11.5 point mono and muted text disappears into the dark field;
  footnotes and evidence locators are functionally unreadable.
- **Root cause:** visual identity was prioritized over document-reading scale.
- **Status:** resolved - body and evidence text now use embedded Segoe UI at
  document-reading sizes on a warm light field with high-contrast ink.

### [PDF-B2] Page 5 nests critical evidence inside an unreadable screenshot

- **Screenshot:** `tmp/pdfs/before/page-5.png`
- **Expected:** the three negative findings can be scanned directly.
- **Actual:** a screenshot containing already-small UI copy occupies half the
  page, forcing the decisive evidence into tiny text twice over.
- **Root cause:** a website capture was used as content instead of supporting
  imagery.
- **Status:** resolved - the screenshot was removed and replaced by three
  direct, full-width evidence rows.

## UGLY

### [PDF-U1] The grid and corner circles compete with every page

- **Screenshots:** all pages
- **Expected:** decoration establishes identity and then recedes.
- **Actual:** high-frequency cyan grid lines and large clipped circles dominate
  the page and create visual fatigue.
- **Root cause:** full-canvas decoration has similar contrast to content rules.
- **Status:** resolved - the grid was removed; low-contrast corner fields and a
  restrained top rule carry the identity without touching reading copy.

### [PDF-U2] Dark cards create a monotonous wall of panels

- **Screenshots:** pages 1, 2, 4, 6, 7, and 8
- **Expected:** clear editorial hierarchy with breathing room.
- **Actual:** nearly every concept is boxed into another dark surface, reducing
  the distinction between primary and supporting information.
- **Root cause:** repeated dashboard-card language in a narrative document.
- **Status:** resolved - the packet now uses editorial whitespace and tinted
  evidence bands, reserving cards for actual grouped information.

### [PDF-U3] Page 6 compresses five milestones into narrow columns

- **Screenshot:** `tmp/pdfs/before/page-6.png`
- **Expected:** milestones and allocations can be compared without effort.
- **Actual:** narrow cards force small type and awkward wrapping.
- **Root cause:** five equal columns on a single 16:9 page.
- **Status:** resolved - milestones are five full-width comparison rows with
  larger type and right-aligned allocations.

## POLISH

### [PDF-P1] Mono typography is used for ordinary reading text

- **Observation:** labels, metrics, source lines, and status chips overuse
  Courier; the texture is technical but tiring.
- **Status:** resolved - mono typography is limited to none of the required
  prose; labels and metrics use the same embedded sans family as the document.

### [PDF-P2] Section labels, footer, and page numbers are too faint

- **Observation:** navigation and provenance should be quiet but still legible.
- **Status:** resolved - provenance and page navigation use higher-contrast
  8.7-10 point sans text and were checked at normal-viewer scale.

## Reviewed screenshots

- [x] `page-1.png` - [PDF-B1, PDF-U1, PDF-U2, PDF-P1, PDF-P2]
- [x] `page-2.png` - [PDF-B1, PDF-U1, PDF-U2]
- [x] `page-3.png` - [PDF-B1, PDF-U1]
- [x] `page-4.png` - [PDF-B1, PDF-U1, PDF-U2]
- [x] `page-5.png` - [PDF-B1, PDF-B2, PDF-U1]
- [x] `page-6.png` - [PDF-B1, PDF-U1, PDF-U2, PDF-U3]
- [x] `page-7.png` - [PDF-B1, PDF-U1, PDF-U2]
- [x] `page-8.png` - [PDF-B1, PDF-U1, PDF-U2, PDF-P2]

## Verification

- [x] Re-rendered all eight pages at 96 DPI under `tmp/pdfs/after/`.
- [x] Re-rendered representative normal-viewer captures at 72 DPI under
  `tmp/pdfs/after-72/`; required text remained readable without zoom.
- [x] Inspected all eight 96-DPI pages and pages 1, 2, 5, 6, and 8 at 72 DPI.
- [x] Confirmed 8 pages at 960 by 540 points, extractable required headings,
  zero replacement characters, and embedded TrueType rendering without the
  earlier display-font warnings.
- [x] `npm run application:package:test` passed with the new byte count and
  SHA-256.
- [x] Application claim, evidence, and site-release verification passed.

---

# Sentient grant PDF credibility triage - 2026-08-01

## Summary

- 3 issues found: 1 broken, 2 ugly; all 3 resolved.
- Areas affected: pages 4, 5, and 7 plus their canonical application sources.
- Screenshots reviewed: freshly rendered pages 4 and 5 at 96 DPI, with page 7
  checked against its source budget and extracted PDF text.

## BROKEN

### [PDF-CB1] The displayed cost basis is not bottom-up auditable

- **Screenshot:** current page 7.
- **Expected:** each non-labor amount has a quantity, unit ceiling, credit
  treatment, and an exact crosswalk to funded milestones.
- **Actual:** compute and hosting lack unit models; documentation appears to
  duplicate maintainer labor; an operator cohort is promised despite the
  applicant's no-outreach boundary; milestone totals reconcile only by sum.
- **Root cause:** the $150,000 total was allocated into planning envelopes
  before direct-cost quantities were established.
- **Status:** resolved - the budget now publishes capped quantities, credit
  treatment, and an exact category-to-milestone crosswalk totaling $150,000.
  Duplicate labor and the unfunded operator-cohort promise were removed.

## UGLY

### [PDF-CU1] Page 4 makes the failed heuristic the dominant ROMA takeaway

- **Screenshot:** `tmp/pdfs/grant-audit-4.png`.
- **Expected:** the page leads with the integration and proof risks already
  retired, then states the remaining economic risk without hiding it.
- **Actual:** the largest headline says the optimizer failed and the highlighted
  row presents 4/6 at 1042.8 seconds beside frontier 6/6 at 47.7 seconds.
- **Root cause:** diagnostic detail was promoted above the result the grant can
  safely rely on.
- **Status:** resolved - page 4 now leads with the reconstructable 24/24-cell
  ROMA proof, zero false passes, and the integration risks retired. The failed
  economic gate remains explicit in a subordinate funded-risk panel.

### [PDF-CU2] Page 5 repeats failure instead of proving delivery capacity

- **Screenshot:** `tmp/pdfs/grant-audit-5.png`.
- **Expected:** one compact claim-discipline boundary supports a page showing
  the shipped substrate, maintainer record, and continuing repository pull.
- **Actual:** three full-width negative studies follow a failed-result page,
  making the packet read like a postmortem rather than a fundable trajectory.
- **Root cause:** evidence completeness was mistaken for narrative priority.
- **Status:** resolved - page 5 now establishes the 134-day solo delivery
  record, current repository footprint, and qualified 14-day interest signal.
  It explicitly states that clone counts are not installs, users, or adoption.

## Acceptance targets

- Page 4 leads with 24/24 measured cells, zero false passes, ROMA control, and
  offline reconstruction while retaining the exact failed economic boundary.
- Page 5 uses dated, source-qualified delivery and GitHub signals without
  calling clones installs, users, adoption, or manually authored code.
- Page 7 contains no duplicate labor or unwanted cohort promise; every cost
  category has a quantity model and every category-to-milestone total reconciles.
- All eight pages remain readable at 72 DPI with no clipping, overflow, or
  extractability regression.

## Verification

- [x] Inspected all eight freshly rendered pages at 96 DPI.
- [x] Inspected changed pages 4, 5, and 7 at 72 DPI; no clipping, overflow, or
  illegible body text was observed.
- [x] Confirmed 8 pages at 960 by 540 points, 6,053 extractable characters,
  zero replacement characters, and no encryption, forms, or JavaScript.
- [x] `npm run application:package:test`, `application:claims:test`,
  `application:evidence:check`, `application:media:test`, and
  `site:release:verify` passed.
- [x] The live Sentient Grant form check passed with 13 required fields and the
  upload-to-thank-you branch.
- [x] The full `npm test` suite passed on 2026-08-01.
