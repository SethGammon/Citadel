---
name: design
description: >-
  Generates and maintains a design manifest for visual consistency. In existing
  projects, reads current styles and documents the design language. In new
  projects, asks a few questions and generates a starter manifest. The post-edit
  hook reads the manifest and flags deviations.
user-invocable: true
auto-trigger: false
effort: medium
---

# /design — Design Manifest Generator

## When to Use

- At the start of a new project (generate starter manifest from preferences)
- On an existing project that has no manifest (extract patterns from existing code)
- When visual inconsistency is noticed ("why do we have 4 different button styles?")
- When /do routes "design", "style guide", "visual consistency", "design manifest"

## Protocol

### Step 1: DETECT MODE

Check for existing styles: look for `tailwind.config.*`, global CSS files, or component files with style patterns. If any exist, use Extract Mode. If none exist or the user says "new project", use Generate Mode.

### Step 2: GATHER INPUT

**Extract Mode**: Read style sources (tailwind config, global CSS, component files). Present findings to user and confirm before writing.

**Generate Mode**: Ask up to 4 questions about feel, color mode, brand colors, and layout density. Use sensible defaults for anything not specified.

### Step 3: WRITE MANIFEST

Write to `.planning/design-manifest.md` using the template defined below. Every section must have real values — no placeholders.

### Step 4: CONFIRM

Present a summary of the manifest to the user: "Here's your design manifest. It will be used by the post-edit hook to flag deviations. Anything to change?"

## Modes

### Extract Mode (existing project has styles)

1. Read `tailwind.config.*` — extract colors, spacing, fonts, breakpoints
2. Read global CSS files — extract CSS variables, base styles
3. Scan 5-10 component files — values used 3+ times become the palette, scale, type scale, shape language, and elevation scale; note component patterns (card, button, input)
4. Present findings: "Here's what I found. Does this look right?"
5. Write manifest after user confirms

### Generate Mode (new project or no existing styles)

Ask up to 4 questions: feel (minimal/playful/corporate/bold), color mode (dark/light/both), brand colors (hex or "pick for me"), layout density. Use sensible defaults for anything not specified.

## The Manifest

Write to `.planning/design-manifest.md`:

```markdown
# Design Manifest

> Generated: {date}
> Mode: {extracted | generated}
> Source: {tailwind.config.ts, globals.css, etc. | user preferences}

## Colors

### Primary Palette
- primary: {hex} — {usage: buttons, links, accents}
- primary-hover: {hex}
- primary-muted: {hex}

### Neutral Palette
- background: {hex}
- surface: {hex} — {cards, modals, elevated elements}
- border: {hex}
- text-primary: {hex}
- text-secondary: {hex}
- text-muted: {hex}

### Semantic
- success: {hex}
- warning: {hex}
- error: {hex}
- info: {hex}

## Typography

- font-family: {value}
- heading-font: {value, or "same as body"}
- Type scale: {xs, sm, base, lg, xl, 2xl, 3xl — with px/rem values}
- Line heights: {tight, normal, relaxed — with values}
- Font weights used: {list}

## Spacing

- Base unit: {4px / 0.25rem}
- Scale: {1, 2, 3, 4, 6, 8, 12, 16, 24 — in base units}
- Component padding: {standard value}
- Section gap: {standard value}
- Page margin: {standard value}

## Shape

- Border radius: {none, sm, md, lg, full — with values}
- Default radius: {which one is used most}
- Shadow scale: {sm, md, lg — with values}

## Layout

- Max content width: {value}
- Breakpoints: {sm, md, lg, xl — with values}
- Grid/flex preference: {which is used more}
- Spacing rhythm: {consistent gaps between sections}

## Component Patterns

{Only populated in extract mode or after the project has components}
- Button: {padding, radius, font-weight, transition}
- Card: {padding, radius, shadow, border}
- Input: {padding, radius, border-color, focus-ring}

## Anti-Patterns (things to flag)

- Colors not in the palette above
- Font sizes not in the type scale
- Spacing values not in the spacing scale
- Border radius values not matching the shape section
- Hardcoded colors instead of CSS variables or Tailwind classes
```

## Hook Integration

post-edit.js checks for `.planning/design-manifest.md`. When a CSS/TSX/JSX/Tailwind file is edited, it scans for: hardcoded hex colors not in the palette, font sizes outside the type scale, spacing values outside the scale, and border radius values not in the shape section. Warnings only — not blocks. One warning per category per edit.

Hook rules: skip entirely if no manifest; scan only the edited file; cache the manifest once per session; do not flag Tailwind utility classes that map to config; only flag raw hex/px values.

## Quality Gates

- Every manifest section has real values (not placeholders)
- Extract mode cites which files the values came from
- Generate mode defaults are sensible (not random)
- Anti-patterns section is populated based on the manifest values

## Fringe Cases

**No styles and no preferences:** Default to Generate Mode; use sensible defaults (minimal, light mode, neutral palette); present before writing.

**Tailwind config but no custom theme:** Extract available values (font, breakpoints); note which sections use Tailwind defaults; generate the rest.

**`.planning/` missing:** Create it; if not possible, output manifest inline and instruct user to save it.

**"Update the manifest":** Re-run Extract Mode, diff against existing manifest, present only what changed.

## Exit Protocol

```
---HANDOFF---
- Design manifest: .planning/design-manifest.md
- Mode: {extracted | generated}
- Sources: {files read, or "user preferences"}
- Anti-patterns documented: {count}
- Next: Post-edit hook will flag deviations automatically
---
```
