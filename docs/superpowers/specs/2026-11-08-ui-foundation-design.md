# Zinc UI foundation and aesthetic pass

Status: approved by owner ("yup go ahead"). Owner chose "Follow the system".

## Visual direction

Give Family Budget a precise, quiet financial-tool appearance using shadcn/ui,
Zinc neutrals, restrained 4–6px corner radii, fine borders and subtle elevation.
Retain system typography for prose and labels. Use locally bundled Geist Mono
for amounts, dates and tabular financial data, with tabular numerals and a
monospace fallback. Keep body text readable at relative sizes and normal weight.

Light appearance uses a pale Zinc page background and white surfaces. Dark
appearance uses near-black Zinc backgrounds and slightly lighter surfaces,
with legible text, borders, inputs and selected states. Status uses text plus
appropriate restrained success/warning/error color, not color alone.

## System appearance

Follow `prefers-color-scheme` at first paint and when the preference changes
while the app is open. Use CSS media-query tokens and native `color-scheme`,
avoiding a saved manual override or unnecessary theme controls. Configure
Tailwind dark variants to follow the same media query. This is an intentional
simplification of shadcn's optional React theme-provider approach for an app
whose owner explicitly wants system appearance.

## Layout and hierarchy

- Shared shell: a compact wordmark/header, clearly selected navigation and a
  centered content column with consistent outer spacing and safe-area padding.
  All current destinations remain reachable under their existing routes.
- Phone navigation wraps or scrolls deliberately within its own region; the
  page itself does not overflow. Active state has shape/border and text cues.
- Paycheck Review: separate the page heading/description, start/resume controls,
  financial result, and working sections into clear visual groups.
- Make safe to spend the strongest financial element. On wide screens place
  its explanation beside secondary coverage metrics; stack these on phones.
  "Needs information" must remain prominent and wrap naturally.
- Use calm major section surfaces and lighter row separation within them.
  Keep disclosures recognizable and put setup/correction tools at lower
  visual emphasis than the review's primary actions.
- Align input heights, label spacing, buttons, supporting text and amounts.
  On wide screens allow related fields to share a row; retain single-column
  forms at narrow widths and enlarged text.
- Primary emphasis belongs to the main save/finish action in each context.
  Add/edit, suggestions, refresh and cancellation use quieter variants.

## Implementation approach

Install Tailwind's Vite integration into the existing app and initialize
shadcn for local, editable components using a Radix-based preset and Zinc
tokens. Confirm current CLI options before running it; keep generated changes
scoped and inspect the dependency/configuration diff. Do not scaffold a new app.

Start with local Button, Card, Input, Label, Badge, Alert and Separator
primitives as useful to the existing screens. Keep native select, date and
disclosure controls where they preserve current web behavior and mobile input.
Use Radix for any new composite interaction that actually needs it. Split-pane
and draggable-grid packages are not needed for the current layouts.

Create one semantic token vocabulary for background, surface, foreground,
muted text, border, focus and status colors. Replace legacy fixed light colors
throughout the stylesheet, dialogs, forms, tables and chart containers so all
screens remain readable in both appearances. Integrate the actual shared
components in Paycheck Review and reusable patterns; apply coherent shared
styling to Budget, Accounts, Bills/Income Overview and Money Flow in this pass.
Review SVG text/edge contrast separately from HTML colors.

Scope files: package/lockfile, Vite and TypeScript configuration,
`components.json`, local UI components/utilities, `web/style.css`,
`web/index.html`, `web/App.tsx`, Paycheck Review sections and other screen
markup as needed for consistent presentation. Preserve financial calculations,
bank authorization, persistence, routes and existing form submissions.

## HIG and browser adaptations

Apply the project's HIG accessibility, typography, layout, buttons, color and
writing baseline. Keep essential information readable, controls >=44 CSS
pixels, visible keyboard focus, semantic labels and error/status announcements.
Preserve browser zoom and system text enlargement. Local fonts avoid external
font requests and fall back gracefully. Respect reduced motion. The visual
pass must not add animation that delays financial information.

## Verification and delivery

Inspect light/dark first paint and a live system-theme switch using synthetic
data. Check Paycheck Review, Budget, Accounts, overview tables and Money Flow
at 320px, 390px and desktop widths; include dialogs, disclosures, disabled,
error, empty and unknown-amount states. Check keyboard navigation, browser zoom,
large text and VoiceOver where available; explicitly record unverified checks.
Do not claim accessibility conformance from build or source inspection.

Run existing financial regression tests, typecheck and an isolated production
build. Add meaningful tests for new theme behavior if JavaScript is required,
rather than snapshot tests of decorative class names. Verify font bundling and
content-security-policy compatibility. Review and commit completed logical
changes with the owner's exact request; push only on request.

References: shadcn existing Vite installation, theming and dark-mode docs;
Vercel Geist font documentation; project's Apple HIG baseline. All were
consulted in this conversation. An implementation plan follows owner review
of this design.
