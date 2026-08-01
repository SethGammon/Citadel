# Citadel public-site experience decisions

> Declared: 2026-08-01
> Scope: `docs/` public GitHub Pages experience

## Experience thesis

Citadel's public site is an evidence-guided product story. It starts with the
smallest useful command, opens into stronger operating controls, and gives a
reviewer a direct route to the claims, failures, receipts, and remaining work.
It should feel like a deep, instrumented control room: calm and legible, but
never neutral, flat, or drab.

## Audience and primary outcome

- A new user should understand `/do`, the four levels, and the first useful
  action in one screenful.
- A technical evaluator should find exact proof boundaries, reproduction paths,
  and open questions without decoding the marketing page.
- A grant reviewer should leave with a credible sequence: useful entry point,
  differentiated control mechanism, published evidence, and funded next gates.

## Visual language

- Ambient palette: near-black ink, ocean blue, cyan, and restrained violet.
  Blue chroma replaces gray as the default secondary tone.
- Semantic palette: green means verified or passing, amber means open or
  conditional, and red means failed or blocked. These colors are never ambient
  decoration.
- Depth: background aurora, section wash, raised panel, and inset control form
  four distinct planes. Borders clarify edges; colored shadow and inset light
  establish elevation.
- Type: the system sans remains direct and familiar; monospace is reserved for
  commands, measurements, receipts, and state. Primary text is crisp white;
  supporting text is blue-lilac, not neutral gray.
- Shape: 12 to 22px radii express containers and grouped evidence. Controls use
  tighter radii than major panels.

## Viewport composition contract

- At 1440 by 900, 1024 by 768, and 390 by 844, each static viewport must contain
  a complete decision unit or an intentional cue to the next unit.
- No section may be invisible while waiting for a reveal animation.
- A heading may introduce content below the fold, but a viewport may not end on
  unexplained dead space or a clipped interactive row.
- Responsive sections use content-driven height. Long evidence groups can span
  multiple screens, but section padding must not create the extra screen.
- Hover and focus movement receives at least 6px of visible clearance. No
  transformed tile may be clipped by a parent overflow boundary.

## Interaction contract

- Motion explains routing, expansion, or inspection; essential content remains
  fully visible before JavaScript and during capture.
- Hover raises interactive surfaces by no more than 3px and also changes border,
  light, or shadow so elevation is not the only cue.
- Focus remains stronger than hover and uses the cyan command color.
- Reduced-motion mode removes spatial movement while preserving state changes.

## Acceptance gates

1. No horizontal overflow on any public page at the three target viewports.
2. Secondary copy meets readable contrast and does not visually dominate as
   gray.
3. All primary panels are distinguishable from the page and from nested controls.
4. Homepage generator tiles, buttons, and cards remain unclipped on hover/focus.
5. Every page hero provides a coherent first screen and a deliberate next cue.
6. Section spacing is consistent and no mobile screenful is mostly dead space.
7. Social and application images match the live palette and hierarchy.
8. Local site checks and hosted smoke checks pass before release.
