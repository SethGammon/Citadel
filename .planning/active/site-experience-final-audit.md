# Citadel final site experience decisions

Observed 2026-08-03 against the local release candidate. This is a refinement
pass, not a rebrand. The public evidence and claim boundaries remain frozen.

## Experience contract

- **Purpose:** let a new visitor understand `/do` first, then progressively
  reveal durable operation control, evidence, economics, and the grant thesis.
- **Emotional target:** calm, credible, technically alive, and candid. The site
  may feel ambitious; it must never feel evasive, frantic, or sales-led.
- **Primary hierarchy:** each viewport should answer one dominant question.
  Supporting cards, metrics, and links must remain subordinate to that answer.
- **Information density:** low-to-medium on the product path; medium-to-high on
  evidence surfaces where the density is meaningful and visibly structured.
- **Motion:** short entrance and interaction feedback only. No perpetual motion
  may compete with reading. Reduced-motion must leave every item visible.
- **Typography:** large editorial headings, readable blue-white body text, and
  mono only for labels, commands, receipts, and measurement details.
- **Color and depth:** retain the current ink, ocean, cyan, blue, green, amber,
  and violet system. Cards need hierarchy from border, tint, and shadow rather
  than a wall of identical gray panels.
- **Responsive behavior:** preserve the same narrative order at every width;
  change layout before copy becomes cramped; never clip links, hover movement,
  focus rings, tables, or proof identifiers.
- **Accessibility:** visible keyboard focus, a functional skip link and mobile
  menu, captioned media, downloadable transcripts, and zero content hidden by
  reduced-motion preferences.
- **Performance:** static-first HTML/CSS with lightweight progressive
  enhancement. Decorative effects must not gate content or navigation.

## Contextual composition

- **Homepage:** one clear entry point, then four levels of increasing power.
  Product demonstration precedes proof and installation detail.
- **Evidence:** evaluator index. Dense comparison material is acceptable when
  each result carries a method, outcome, and claim boundary.
- **Operation Control:** explain the contract, then show the proof and the
  novelty boundary. Evidence must remain more prominent than aspiration.
- **Optimizer:** show why cheap failure is not savings, then reveal the policy
  contract, existing proof, open gates, and funded thesis.
- **Research:** present current implementation in descending claim strength,
  then funded milestones and the exact boundary of demonstrated work.
- **Walkthrough:** media first; the full transcript is an accessible secondary
  path that unfolds on request instead of becoming a wall of prose.
- **404:** one explanation and two recovery actions, with no additional noise.

## Anti-defaults

- No equal-weight card wallpaper without a leading editorial statement.
- No metric wall without a nearby explanation of what the numbers permit.
- No duplicate calls to action with indistinguishable intent.
- No perpetual animation, hidden scrollbar, or clipped hover transform.
- No run-on link cluster or inline CTA styling that breaks below 390 pixels.
- No full transcript wall when the same information can be disclosed on demand.

## Verification matrix

Every public page is reviewed at 1440x900, 1280x720, 768x1024, 390x844, and
320x568. The catalog contains 373 overlapping viewport screenshots across:

1. Homepage
2. Evidence
3. Operation Control
4. Optimizer
5. Research
6. Walkthrough
7. 404

The release gate additionally checks overflow, navigation behavior, focus,
normal and reduced motion, console errors, and claim-sensitive site tests.
