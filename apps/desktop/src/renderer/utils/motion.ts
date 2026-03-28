// Motion constants for consistent animation timing across the app.
// Source: derived from Tailored Realms design system (fast/standard/slow tiers).

export const DURATION = {
  fast: 120,      // Hover states, quick feedback
  standard: 200,  // Surface entry, content transitions
  slow: 280,      // Overlay/modal entry, panel slides
} as const;

export const EASE = {
  standard: 'cubic-bezier(0.25, 0.10, 0.25, 1)',    // Calm, professional
  emphasized: 'cubic-bezier(0.33, 0.00, 0.20, 1)',  // Snappy, directional
} as const;

/** Build a CSS transition string for the given properties at fast speed. */
export function fastTransition(...props: string[]): string {
  return props.map((p) => `${p} ${DURATION.fast}ms ${EASE.standard}`).join(', ');
}

/** Build a CSS transition string for the given properties at standard speed. */
export function transition(...props: string[]): string {
  return props.map((p) => `${p} ${DURATION.standard}ms ${EASE.standard}`).join(', ');
}
