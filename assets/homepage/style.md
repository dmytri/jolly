# Homepage Style

Durable approved homepage visual style. `homepage/index.html` is derived from this file.

## Theme

Dark retro-futuristic / CRT terminal aesthetic.

## Color palette

| Token         | Value     | Usage                                |
|---------------|-----------|--------------------------------------|
| `--bg`        | `#0a0a0f` | Page background                      |
| `--bg-card`   | `#111118` | Card / box backgrounds               |
| `--bg-input`  | `#16161e` | Badge / input backgrounds            |
| `--border`    | `#2a2a3a` | Default borders                      |
| `--text`      | `#e0e0e8` | Primary text                         |
| `--text-dim`  | `#8888a0` | Secondary text, badges               |
| `--accent-gold`  | `#f0b34b` | Brand accent (logo, links, hover) |
| `--accent-amber` | `#d48c2c` | Secondary accent (section titles) |
| `--neon-green`   | `#39ff8c` | Primary accent (tagline, grid, success) |
| `--neon-dim`     | `#1a6e3a` | Dimmed green                      |
| `--red`          | `#ff4466` | Error state                       |

## Typography

- **Display:** Orbitron (weights 700, 900) — used for logo, tagline, section titles
- **Mono:** JetBrains Mono (weights 400, 500, 700) — used for copy box text, badges
- **Body:** Inter (weights 400, 500, 600, 700) — used for body text, buttons

## Visual effects

- CRT scan lines overlay (subtle repeating 3px horizontal lines, 0.03 opacity)
- Neon green grid overlay (60px spacing, 0.03 opacity)
- Tagline has neon glow text-shadow (20px/40px/80px layers)
- Tagline has subtle glitch animation (4s infinite, ±2px translate)
- Cards have hover border-color transition to accent-gold

## Layout

- Container: max-width 900px, centered, 2rem/1.5rem padding
- Copy box: max-width 680px, centered
- Flow grid: 2-column, collapses to 1-column below 600px
- Agent badges: flex-wrap, centered

## Component shapes

- Cards: 8px border-radius
- Copy button: 6px border-radius
- Agent badges: 20px border-radius (pill)
