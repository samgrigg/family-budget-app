# Design and UI baseline

Use Apple's Human Interface Guidelines as the basis for all design and UI decisions in this project: https://developer.apple.com/design/human-interface-guidelines

Preserve the owner's mobile-first, sparse, utilitarian startup aesthetic. Apply HIG principles to a web/PWA implementation; do not imitate native components at the expense of browser conventions or accessibility.

- Start at narrow phone widths; adapt to wider screens. Respect safe areas and text enlargement.
- Use system typography, relative font sizes, readable body text, and clear hierarchy. Keep essential information out of tiny captions.
- Provide at least 44 by 44 CSS-pixel touch targets as the web adaptation of Apple's 44-point guidance.
- Maintain sufficient text contrast, visible keyboard focus, semantic controls and accessible names. Never communicate state through color alone.
- Preserve browser zoom. Check large text, keyboard navigation, and VoiceOver before claiming accessibility conformance.
- Keep labels direct, feedback understandable, and destructive actions clearly named and confirmed.
- Review relevant current HIG sections when changing UI. Document intentional web-specific adaptations and verification gaps.

Reference sections: accessibility, typography, layout, buttons, color, and writing. HIG is guidance, not a certification; do not claim complete compliance based only on source inspection or a build.
