# Zinc UI Foundation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline, as the owner already selected. Track the steps below; do not dispatch subagents.

**Goal:** Apply the approved shadcn/Zinc aesthetic with automatic system appearance across the existing app.

**Architecture:** Add Tailwind Vite integration and locally owned Radix-based shadcn primitives. Use semantic CSS variables, with dark values selected directly by prefers-color-scheme, to serve generated components and existing screens consistently. Bundle Geist Mono locally for financial data.

**Tech Stack:** Existing React/TypeScript/Vite; Tailwind, local shadcn components and their narrow dependencies; Geist Mono font files.

**Spec:** `docs/superpowers/specs/2026-11-08-ui-foundation-design.md`, approved by owner: "yup go ahead".

## Global constraints

- Preserve financial behavior, bank access, persistence, routes and form submissions.
- System text for prose; Geist Mono for financial data with a monospace fallback.
- Respect safe areas, 44px controls, browser zoom, visible focus and reduced motion.
- Follow system appearance at first paint and live, without a saved override.
- Use synthetic/in-memory data for browser verification.
- Inspect staged diffs and commit verified logical changes. Request line: `yup go ahead`. Do not push.

## Task 1: Shared UI and theme foundation

Files: `package.json`, lockfile, `vite.config.ts`, `tsconfig.json`,
`components.json`, `web/lib/utils.ts`, `web/components/ui/*`,
`web/theme.css`, `web/main.tsx`, `web/index.html`.

- [ ] Establish baseline with `PATH=/opt/homebrew/bin:$PATH npm test` and `npm run typecheck`.
- [ ] Inspect current CLI via `npx shadcn@latest init --help`; use existing-project initialization with Radix and Zinc. Install `tailwindcss` and `@tailwindcss/vite`; preserve the current web root and build paths.
- [ ] Add `@/*` alias to `web/*` in TypeScript and Vite before component generation.
- [ ] Generate only Button, Card, Input, Label, Badge, Alert and Separator needed for the approved design. Inspect dependencies and local component sources.
- [ ] Bundle Geist Mono using a registry font package or licensed local font asset. Preserve CSP without external font requests.
- [ ] Define CSS tokens for foreground/background/card/popover/primary/secondary/muted/border/input/ring/status, exposing them to Tailwind. Put alternate values inside `@media (prefers-color-scheme: dark)` and set native color-scheme.
- [ ] Keep Tailwind's dark variant media-driven. Avoid the generated class-based override if the CLI inserts one.
- [ ] Run typecheck and isolated build; verify generated dependency and configuration diffs before committing this foundation.

Vite integration keeps its existing shape:

```ts
import tailwindcss from '@tailwindcss/vite';
// Add plugins: [tailwindcss()] and resolve.alias for @ -> web.
// Retain root: 'web', build.outDir: '../dist', emptyOutDir: true.
```

## Task 2: Apply the visual system to real screens

Files: `web/style.css`, `web/App.tsx`, `web/ReviewSummary.tsx`,
`web/PaycheckReview.tsx`, `web/ReviewCommitments.tsx`,
`web/ReviewCards.tsx`, `web/ReviewObligationForm.tsx`,
`web/IncomeSourceSetup.tsx`, `web/ExpectedAmountField.tsx`,
other screen markup only where needed for coherent presentation.

- [ ] Replace legacy fixed light foregrounds/surfaces/borders with semantic tokens, covering inputs, tables, dialogs, graph surfaces, badges and errors.
- [ ] Restyle the compact app header/navigation and constrain content with consistent spacing.
- [ ] Integrate real shared UI primitives in paycheck-review components. Preserve native select/date/details controls and existing accessible labels.
- [ ] Give safe to spend a distinct summary surface, mono amount and aligned secondary metrics; stack at phone widths.
- [ ] Use consistent input/button heights, small radii, calm surfaces, row separators and action hierarchy. Ensure text and amounts wrap at enlarged sizes.
- [ ] Check SVG label and graph contrast separately. Preserve distinct data colors and text descriptions.
- [ ] Run financial regression tests, typecheck and isolated build. Decorative class snapshots are not required; add a regression only if component integration changes meaningful behavior.

## Task 3: Verify appearances and document results

Files: `README.md`, this plan, approved design status.

- [ ] Use an in-memory synthetic app to verify Paycheck Review, Budget, Accounts, Bills/Income Overview and Money Flow in light and dark appearances.
- [ ] Inspect 320px, 390px and desktop layouts; check first paint, system appearance changes, unknown/error/disabled states, native controls and dialogs.
- [ ] Exercise keyboard focus, browser zoom/large text, and VoiceOver when available. Record unavailable checks explicitly.
- [ ] Run `PATH=/opt/homebrew/bin:$PATH npm test`, `npm run typecheck`, `npx vite build --outDir /tmp/budget-zinc-build`.
- [ ] Review relevant current HIG sections and document intentional web adaptations. Self-review with both Ninth House voices under the owner's existing model waiver.
- [ ] Inspect staged file list/diff, excluding all private data and generated builds; commit and report hashes. Leave branch unpushed.

## Review

All approved scope is covered above: theme/dependencies in Task 1, app-wide
presentation and review hierarchy in Task 2, visual and regression evidence
in Task 3. No bank/provider/backend changes are planned. Exact versions and
CLI flags come from the installed tooling, not assumptions about old docs.

## Execution record

Implemented inline on the existing `codex/paycheck-review` branch. The owner
approved the design and execution with "yup go ahead". Planning commit:
`8ec0bb9`; complete visual foundation/application commit: `963f96e`.

The current CLI uses `--base radix --preset nova`; it records `radix-nova` in
components.json. Ran the base-color migration to Zinc and generated seven
local primitives. Removed the generated unused Geist Sans, icon package and
CLI runtime dependency. Local components depend on the maintained Radix
package and generated class utilities; all fonts bundle from npm assets.
Foundation and app styling were committed together to avoid an intermediate
Tailwind-reset state with unreadable legacy screens.

Changed presentation/configuration only. No backend, bank access, database,
financial calculation, authorization or workflow persistence changes. Applied
semantic tokens throughout legacy CSS and SVG graphs. Kept native web controls,
reduced-motion handling, focus outlines and >=44px review controls. Restored
native modal centering after the Tailwind reset removed its default margin.

Observed verification:

- 215 JavaScript tests pass in 38 files; typecheck passes.
- Isolated production build passes at `/tmp/budget-zinc-build`; Geist Mono
  WOFF2 assets are present and browser font-family inspection confirms use.
- Actual browser system preference was dark; body background resolved to the
  intended dark Zinc token. Dark QA visited every main destination.
- Browser review checked 390px and 320px; the latter had scroll width equal
  to viewport width and no visible review controls below 44px.
- Unknown-amount text remained within 320px. Dialog background matched dark
  tokens, was centered, and Escape restored focus to Settings.
- Light Review and Money Flow dialog inspected via a temporary isolated
  built-CSS palette preview. No user system setting was changed.
- Synthetic desktop/mobile screenshots saved outside the repo under `/tmp`.
- Relevant HIG accessibility, typography, layout, buttons, color and writing
  sections were consulted from the official Markdown fetched in this session.
  CSS pixels, native controls and disclosure are intentional web adaptations.

Remaining gaps: actual live system appearance switching, VoiceOver, effective
large-text/zoom testing, every native-control/error combination in both themes,
and actual-device verification. No accessibility conformance claim.

No decorative class snapshot tests were added. All existing behavior tests
passed after shared-control integration. npm audit is back to its initial
three development-tool advisories after removing the CLI runtime; broad
breaking test-tool upgrades are outside this change. No production data,
credentials or generated build output is committed.

Inline Ninth House review ran with the owner's model waiver. Verdict: proceed
with the visual pass and keep the verification gaps explicit. Work remains
local and unpushed.
