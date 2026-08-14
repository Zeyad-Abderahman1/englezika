# Englizeka UI/UX Audit

## Scope and method

The repository, route tree, component architecture, 6,569-line legacy global stylesheet, Next.js 16 bundled guidance, public/auth routes, and protected-route redirects were inspected. Real before screenshots were captured at 1440×900 and 390×844. The audit prioritizes completion of learning tasks and preserves API, security, permission, payment, course, and exam behavior.

## Findings

| Severity | Surface | Finding | Resolution |
| --- | --- | --- | --- |
| High | Global | The red/black visual system was dramatic but visually tiring for long learning sessions and dominated content hierarchy. | Preserved the red/black identity while restricting red to primary actions and active states and using neutral reading surfaces. |
| High | Home | Animation-dependent hero content disappeared in long-page baseline captures and produced unreliable first impressions. | Removed hero entrance/background drift animation and made content statically visible. |
| High | Mobile home | The hero was dense, with five floating labels, oversized type, and competing claims/actions. | Reduced labels to three on desktop and none on mobile, removed unverified statistics, stacked actions, and recomposed the portrait/copy. |
| High | Accessibility | Focus treatment was inconsistent and no skip link existed. | Added a global skip link and high-contrast `:focus-visible` treatment. |
| Medium | Navigation | Mobile menu did not close on Escape and its label did not reflect open state. | Added Escape handling, `aria-controls`, changing accessible name, explicit button types, and route-change close. |
| Medium | Courses | Course cards used strong red decoration and promotional emphasis on every item. | Normalized cards to quiet surfaces, restrained semantic badges, clearer actions, and brand-accented metadata. |
| Medium | Authentication | Large dark panels and glow-like red emphasis made routine sign-in feel heavier than necessary. | Applied calm surfaces, 48px fields, consistent focus/error treatment, and reduced elevation. |
| Medium | Student/exam/admin shells | Repeated panels used inconsistent legacy red values and excessive visual depth. | Normalized shared dashboard, quiz, learning, and admin surfaces through common tokens without changing behavior. |
| Medium | Performance | Hero image explicitly bypassed Next image optimization. | Removed `unoptimized`; no UI dependency was added. |
| Low | Motion | Many decorative infinite animations remained active by default. | Removed core hero loops and added a global reduced-motion safeguard. |

## Architecture assessment

The React architecture is already sensibly split into server pages and focused interactive client components. Rebuilding it would add risk without corresponding UX value. The primary technical debt is CSS: a large global stylesheet contains repeated era-specific overrides. The redesign therefore adds a final, explicit design-system layer while retaining structural selectors and business logic. Future feature work should gradually move component-specific rules into CSS Modules.

## Verification constraints

Public home, courses, login, registration, and staff login were rendered directly. Student dashboard, lesson, exam, result, and authenticated admin routes redirected correctly without seeded browser credentials; their shared UI selectors were normalized and their functional logic was covered by repository tests, but their authenticated visual interiors are recorded as not fully browser-verified.
