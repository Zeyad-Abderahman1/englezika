---
name: englizeka-uiux-system
description: Preserve and apply Englizeka's premium Arabic-first visual language, RTL behavior, reusable UI tokens, component standards, responsive rules, and accessible interaction states. Use for any Englizeka frontend design, component, page, layout, or CSS change.
---

# Englizeka UI/UX System

## Workflow

1. Preserve routes, permissions, API contracts, and business logic.
2. Reuse established tokens and shared components before adding one-off styles.
3. Treat Arabic RTL and mixed-direction text as first-class behavior.
4. Prefer semantic HTML, server components, CSS interactions, and native controls.
5. Render and verify changed surfaces at mobile and desktop widths.

## Visual language

- Use Englizeka's red-and-charcoal identity with neutral reading surfaces. Reserve red for primary actions, selected states, and focused brand accents so it remains strong without overwhelming small screens.
- Keep surface hierarchy explicit: canvas, raised surface, inset/soft surface, interactive surface.
- Use the spacing scale `4, 8, 12, 16, 24, 32, 48, 64, 96` pixels.
- Use radii of `8px` for controls, `12px` for compact surfaces, `16px` for primary panels, and full circles only for avatars/icons.
- Use low-opacity borders and one restrained elevation shadow. Avoid gradients, glow, glass effects, and ornamental cards.
- Use Arabic-friendly type with generous line height: body at least `1.7`, headings at least `1.25`. Never tighten Arabic letter spacing.

## Component standards

- Buttons: minimum 44px target, clear primary/secondary/quiet/destructive variants, visible hover/focus/disabled/loading states.
- Forms: persistent labels, useful hints, inline error messages, logical properties, `dir=ltr` for email/URLs when needed.
- Navigation: clear active state, predictable RTL order, responsive drawer with labeled control, no fake actions.
- Course cards: image, level/status, title, concise metadata, progress/action; avoid duplicate badges.
- Dashboards: lead with next action and progress, then supporting data; keep admin tables dense and scannable.
- Tables: semantic headers, responsive containment, status text plus color, actions consistently placed.
- Feedback: supply skeleton, empty, error, success, and loading states with a meaningful next action.

## RTL and responsive rules

- Prefer `margin-inline`, `padding-inline`, `inset-inline`, `border-inline`, and `text-align: start`.
- Mirror directional arrows and progress only when their meaning is directional; never mirror universal media icons.
- Isolate emails, IDs, dates, and mixed English with `dir`/`bdi` as appropriate.
- Recompose at small widths: stack actions, collapse navigation, transform dense tables only when necessary, and prevent horizontal page overflow.
- Keep primary actions reachable, touch targets at least 44px, and long Arabic strings wrapping safely.
- Validate 320, 360, 390, and 430px widths without masking defects through document-level overflow hiding. Find and constrain the actual offending element.

## Accessibility and motion

- Preserve landmarks, heading order, native labels, keyboard access, and table semantics.
- Use a high-contrast `:focus-visible` ring on every interactive element.
- Never rely on color alone for status. Meet WCAG AA contrast for body text and controls.
- Keep transitions between 120–240ms and honor `prefers-reduced-motion`.
