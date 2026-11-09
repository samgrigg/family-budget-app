# HIG usability review — web/PWA

Reviewed current HIG foundations, accessibility, color, feedback and navigation guidance, plus Apple's Design Awards descriptions. Sources:
- https://developer.apple.com/design/human-interface-guidelines/
- https://developer.apple.com/design/human-interface-guidelines/accessibility
- https://developer.apple.com/design/human-interface-guidelines/color
- https://developer.apple.com/design/human-interface-guidelines/feedback
- https://developer.apple.com/design/tips/
- https://developer.apple.com/design/awards/

Apple's award criteria include interaction and inclusivity; HIG adherence alone does not establish award quality or eligibility. Current POC is not award-ready. The owner requested a sparse startup aesthetic, so this pass prioritizes clarity and usable behavior over ornament.

Findings addressed:
- Flat heading hierarchy: larger page titles distinct from section headings, clearer reading rhythm.
- Small critical labels/amounts: larger transaction amounts, account/date labels, stronger secondary text contrast, increased contrast preference support.
- Navigation orientation: page-specific browser titles, focus new page heading on route changes, skip-to-content link, clearer selected navigation, budget shortcuts to long-page sections.
- Weak action feedback: persistent polite status messages for bill/transfer decisions; confirm/reject operations already reversible.
- Misleading provenance: bill “To” changed to “Description” because imported text is not proof of destination.
- Disclosure sizing: global native summary controls have 44px minimum height; compact timeline adapts to one column at narrow widths; payment checkbox rows wrap.
- Filter scope: label explicitly says bills and transactions, avoiding implication that transfer review is filtered too.

Intentional web adaptations: native links with browser history, details/summary, select, semantic buttons, visible focus, browser zoom and rem typography. No simulated iOS controls, required gestures, decorative animation, or Liquid Glass imitation.

Verification: TypeScript/build pass; browser Budget and populated Bills Overview inspected. Route click focused H1, page titles updated, no horizontal overflow at the current 569px preview, no rendered summary shorter than 44px on Budget. Data-changing UI actions not exercised on real finances. VoiceOver, full keyboard journey, 200%/400% zoom, 320px/device matrix, forced colors, live-region announcements and actual mobile Safari remain unverified. No accessibility conformance claim.

Remaining product/design work: long review queues need search/pagination and better grouping; action focus restoration when a reviewed card disappears; background freshness/account-type state feedback; institution reconnection; consistent monetary formatting; user-editable payment dates and expected amounts before estimates become dependable budgeting commitments. Session success notices can persist across view changes, and repeated identical announcements need further assistive-technology testing. Future native app should be designed for its platform rather than mechanically porting the website.
