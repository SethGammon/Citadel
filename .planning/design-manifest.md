# Citadel Design Manifest

> Generated: 2026-07-12
> Mode: extracted and refined
> Sources: `docs/index.html`, `dashboard/styles.css`, and `assets/*.svg`

## Brand idea

Citadel is a protected operating layer. Its visual language uses gates, lanes, checkpoints, and receipts to make routing, persistence, coordination, and evidence visible. It should feel precise and engineered, not medieval and not like generic neon AI tooling.

## Colors

### Ambient palette

- ink: `#030812`, the deepest page plane
- ocean: `#06111f`, the default page field
- surface: `#0a1d30`, a visibly blue panel rather than neutral charcoal
- surface-raised: `#102b47`
- surface-soft: `#173b5b`
- secondary text: `#b8d5e8`, blue-white rather than gray
- dim technical text: `#7fa6c2`

### Primary palette

- command: `#29b6d8`, used for primary actions and active routing
- command-hover: `#55c7e1`
- command-muted: `#163641`
- evidence: `#4fb875`, used only for verified or passing state
- campaign: `#d09a58`, used for durable work and active phases
- fleet: `#9d87d9`, used for parallel coordination

### Structural palette

- border: `#245979`
- border-strong: `#3a86aa`
- text-primary: `#f4fbff`
- backgrounds stay chromatic even at low luminance; neutral gray is not a
  default surface or text role

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
- borders clarify structure, while colored ambient shadows and inset highlights
  establish four readable depth planes
- glow is restrained and ambient; strong glow remains reserved for active
  transition or verified state change

## Motion

- motion must explain a state transition
- canonical sequence: request, evaluate, select, execute, verify, persist
- standard durations: 160ms, 280ms, 480ms
- no permanently looping decorative motion except a subtle active-state indicator
- every sequence ends in an inspectable state
- provide replay and respect `prefers-reduced-motion`

## Component patterns

- button: 12px vertical padding, 16px horizontal padding, 4px radius, 700 weight
- card: 20 to 28px padding, 12 to 18px radius, one-pixel structural border,
  inset highlight, and a low-opacity blue or violet shadow
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
- gray-on-gray panels that flatten the hierarchy
- invisible reveal states that make a static viewport look empty
- hover transforms inside clipping containers
- em dashes in public copy
- claims such as any project, no config, or guaranteed routing without a stated boundary
