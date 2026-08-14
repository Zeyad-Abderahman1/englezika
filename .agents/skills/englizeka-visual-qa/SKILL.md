---
name: englizeka-visual-qa
description: Render and systematically verify Englizeka routes for professional layout, Arabic RTL, responsive behavior, overflow, interactions, keyboard accessibility, and visual regressions. Use after frontend changes and for before/after UI capture.
---

# Englizeka Visual QA

## Required loop

For every important changed route:

1. Render the real route with real or available seeded data.
2. Capture a screenshot at desktop (`1440x900`) and mobile (`390x844`); add tablet or edge widths when the layout changes materially.
3. Inspect hierarchy, typography, spacing, imagery, loading/error state, and overall polish.
4. Check Arabic alignment, navigation order, directional icons, mixed-direction content, wrapping, and clipping.
5. Check horizontal overflow, responsive collapse, sticky elements, menus, dialogs, forms, tables, and touch targets.
6. Exercise primary interactions and keyboard focus order. Inspect console and failed requests.
7. Record defects with route, viewport, severity, and evidence.
8. Fix defects and repeat the same viewport and interaction until resolved.

## Acceptance checks

- No horizontal page overflow at 320, 390, 768, 1366, and 1920 widths.
- No clipped Arabic text, overlapping controls, broken images, or placeholder UI.
- Navigation and calls to action remain obvious without excessive cards or badges.
- Focus is visible; controls have names and usable target sizes; status does not rely only on color.
- Mobile layouts are recomposed, not merely scaled down.
- Admin tables stay scannable on laptop and safely contained at narrower widths.
- Reduced-motion preference disables nonessential animation.

Save baseline evidence under `docs/uiux/before/`, final evidence under `docs/uiux/after/`, and summarize verified versus blocked routes honestly.
