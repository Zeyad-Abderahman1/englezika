# Englizeka Design System

## Direction

Englizeka is an Arabic-first secondary-school learning product: focused, credible, energetic without being noisy, and efficient during repeated study. Red carries primary actions and active states, charcoal establishes hierarchy, and neutral reading surfaces keep long lessons comfortable.

## Tokens

| Role | Light | Dark |
| --- | --- | --- |
| Canvas | `#f7f8f5` | `#101614` |
| Surface | `#ffffff` | `#17201d` |
| Inset surface | `#eef2ef` | `#1d2925` |
| Text | `#17211f` | `#f4f8f6` |
| Muted text | `#5b6966` | `#a9b9b4` |
| Border | `#dce4e1` | `#2d3b37` |
| Brand | `#d7193f` | `#d7193f` |
| Brand strong | `#9f1239` | `#9f1239` |
| Accent | `#d7193f` | `#d7193f` |
| Focus | `#0b6fdd` | `#0b6fdd` |

Spacing follows 4, 8, 12, 16, 24, 32, 48, 64, and 96px. Controls use 8px radii, primary surfaces use 16px, and elevation is a single restrained shadow. Arabic body copy uses Cairo with at least 1.7 line height.

## Components

- Buttons: minimum 44px target; primary, outline, ghost, light, disabled, and destructive semantics remain explicit.
- Forms: persistent labels, 48px fields, inline validation, natural RTL alignment, and visible focus rings.
- Navigation: stable active marker, responsive menu, Escape close, route-change close, correct accessible names.
- Course cards: semantic badge only when useful, concise metadata, price and action grouped at the end.
- Learning surfaces: quiet canvas and clear surface hierarchy keep progress and next action dominant.
- Exam surfaces: high-readability question panels, visible progress/timer hierarchy, restrained status color.
- Admin: dense predictable panels and tables, dark navigation rail, minimal elevation, consistent active state.

## RTL and responsive rules

Use logical properties for new work, isolate mixed-direction values when needed, preserve natural RTL navigation order, and avoid mirroring universal media icons. Recompose below 800px: collapse navigation, stack actions, reduce decorative hero content, contain tables, and keep touch targets at least 44px. No public/auth route may produce horizontal page overflow at 390 or 1440px.

## States and accessibility

Loading uses existing skeleton components; empty and error states retain a clear next action. Status must include text or icon—not color alone. Native semantics are preferred. Every interactive element receives a visible focus ring, motion respects `prefers-reduced-motion`, and page content is reachable through the global skip link.
