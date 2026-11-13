# Design: piqa QA surface

The locked system shared by every Hallmark app screen. Tokens live in `src/styles/tokens.css`; preserve all existing content, state transitions, backend methods and event handlers.

## System

- Genre: modern-minimal
- Shape: app screen
- Theme: Console, graphite
- Axes: dark/grotesk-sans/chromatic-amber; posture: restrained
- Signature: the mixed-channel case workbench and its traceable measured evidence

## Tokens

`src/styles/tokens.css` is the source of truth.

```css
:root {
  --color-paper: oklch(17% 0.008 250);
  --color-paper-2: oklch(21% 0.009 250);
  --color-paper-3: oklch(13.5% 0.007 250);
  --color-ink: oklch(95% 0.005 250);
  --color-ink-2: oklch(83% 0.008 250);
  --color-muted: oklch(71% 0.01 250);
  --color-rule: oklch(31% 0.01 250);
  --color-accent: oklch(82% 0.15 80);
  --color-accent-ink: oklch(18% 0.04 75);
  --color-focus: oklch(82% 0.15 80);
  --font-display: "Host Grotesk", "Noto Sans Thai", ui-sans-serif, system-ui, sans-serif;
  --font-outlier: "Atkinson Hyperlegible Mono", ui-monospace, monospace;
  --radius-card: 10px;
  --radius-pill: 6px;
  --rule-hair: 1px;
  --shadow-card: none;
}
```

Amber indicates a person, current action or deviation. Cool blue indicates a measured channel or reading.

## Controls

- Primary: amber fill, paired dark ink, 6px radius, 40px height with an expanded hit target
- Secondary: one hairline outline on paper-2; same radius and height
- Labels use the body face; measured values and output use the mono face

## Motion

State changes only. No reveals, hover lift or ambient motion. Reduced motion removes all animation and
transitions.

## Exports

The shared system is exported as `src/styles/tokens.css`. No Tailwind or component-library export is
configured.
