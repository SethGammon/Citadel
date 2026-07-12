# Citadel Design Manifest

> Generated: 2026-07-12
> Mode: extracted and refined
> Sources: `docs/index.html`, `dashboard/styles.css`, and `assets/*.svg`

## Brand idea

Citadel is a protected operating layer. Its visual language uses gates, lanes, checkpoints, and receipts to make routing, persistence, coordination, and evidence visible. It should feel precise and engineered, not medieval and not like generic neon AI tooling.

## Colors

### Primary palette

- command: `#29b6d8`, used for primary actions and active routing
- command-hover: `#55c7e1`
- command-muted: `#163641`
- evidence: `#4fb875`, used only for verified or passing state
- campaign: `#d09a58`, used for durable work and active phases
- fleet: `#9d87d9`, used for parallel coordination

### Neutral palette

- background: `#0b0f14`
- surface: `#121820`
- surface-raised: `#18212b`
- border: `#2c3946`
- text-primary: `#edf3f7`
- text-secondary: `#b2bec8`
- text-muted: `#778592`

### Semantic palette

- success: `#4fb875`
- warning: `#d09a58`
- error: `#e16b64`
- info: `#29b6d8`
- unknown: `#8895a2`

## Typography

- body: system UI stack
- technical: `SFMono-Regular`, Consolas, monospace
- headings: body stack, 700 to 800 weight
- type scale: 12, 14, 16, 20, 28, 40, 64px
- line heights: 1.1 tight, 1.5 normal, 1.7 relaxed

## Spacing and shape

- base unit: 4px
- scale: 4, 8, 12, 16, 24, 32, 48, 72px
- content width: 1120px
- component padding: 16px or 24px
- section gap: 72px
- radii: 4px controls, 8px panels, 12px feature surfaces
- borders are preferred over large shadows
- glow is reserved for an active transition or verified state change

## Motion

- motion must explain a state transition
- canonical sequence: request, evaluate, select, execute, verify, persist
- standard durations: 160ms, 280ms, 480ms
- no permanently looping decorative motion except a subtle active-state indicator
- every sequence ends in an inspectable state
- provide replay and respect `prefers-reduced-motion`

## Component patterns

- button: 12px vertical padding, 16px horizontal padding, 4px radius, 700 weight
- card: 24px padding, 8px radius, one-pixel border
- terminal: restrained monospace, no fake typing longer than three seconds
- proof receipt: source, result, timestamp or run reference, and truth boundary
- status: semantic color plus text label, never color alone

## Anti-patterns

- rainbow accents without semantic meaning
- glow on inactive surfaces
- decorative scans that do not represent evaluation
- unsupported live counters
- feature counts copied manually into multiple public surfaces
- mocked evidence presented as a live run
- em dashes in public copy
- claims such as any project, no config, or guaranteed routing without a stated boundary
