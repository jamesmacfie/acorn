# Accessibility, responsive behavior and mobile mapping

Status: Normative<br>
Requirement prefix: `UI-A11Y`

Electron desktop is the V2 client. Responsive semantics and renderer capability negotiation ensure
the contracts do not make a future mobile client impossible; mobile implementation is not a V2
deliverable.

## Accessibility

- **UI-A11Y-001:** Acorn targets WCAG 2.2 AA for host and semantic contributions. Bespoke artifacts
  MUST meet the same target before Acorn Verified publication.
- **UI-A11Y-002:** Every interactive element has accessible name, role, state, description where
  needed, logical tab order, visible focus and keyboard operation. Icon/glyph alone is insufficient.
- **UI-A11Y-003:** Host landmarks are Fleet navigation, topbar, main view, task pane row,
  notifications and modal layer. Contribution headings fit the host outline and cannot reset it
  arbitrarily.
- **UI-A11Y-004:** State is never communicated by color alone. Status includes text/icon/pattern;
  diff additions/deletions include markers; charts expose summaries/tables.
- **UI-A11Y-005:** Host theme/style combinations maintain contrast, zoom to 200%, text spacing and
  reduced-motion behavior. Plugins choose semantic tones, not colors.
- **UI-A11Y-006:** Dynamic updates preserve focus unless an explicit safe focus intent follows user
  action. Significant async changes use bounded polite announcements; security/destructive prompts
  may use assertive announcement.
- **UI-A11Y-007:** Virtualized lists, grids, diffs, transcripts and trees expose total/position,
  keyboard navigation and non-visual access without requiring every row in the DOM.
- **UI-A11Y-008:** Terminal and editor expose platform accessibility modes, selection, focus escape
  and shortcut discovery without corrupting cell/text geometry.
- **UI-A11Y-009:** Pointer-only drag/resize/reorder actions have keyboard commands. Minimum pointer
  target is 24 CSS pixels with 44-pixel spacing/target where the responsive size class permits.

## Size classes

| Class | Width | Required adaptation |
| --- | --- | --- |
| `compact` | below 720 CSS px | one primary surface, drawers/sheets for secondary |
| `medium` | 720–1199 | rail may collapse, at most two visible task panes |
| `expanded` | 1200+ | full rail and flat pane row |

- **UI-A11Y-010:** Contributions receive size class and allocated bounds, not global screen
  dimensions. They declare renderer adaptations for supported classes.
- **UI-A11Y-011:** Core may present the flat task pane row as one active pane plus switcher in
  compact mode without changing persisted order, weights or pins.
- **UI-A11Y-012:** Tables provide card/detail or horizontal-scroll behavior as declared; data
  essential to identity/action cannot disappear solely by width.
- **UI-A11Y-013:** Bespoke UI uses the same allocated size classes and must not assume resizable
  desktop window, hover, mouse, physical keyboard or unrestricted viewport.

## Future mobile mapping

- **UI-A11Y-014:** Mobile clients may omit `acorn.code-editor` editing, multi-pane layout,
  interactive terminal input, browser-preview native views and bespoke UI while still supporting
  Fleet, attention, read-only status and compatible declarative contributions.
- **UI-A11Y-015:** Every contribution declares `mobileBehavior`: compatible semantic view,
  alternate semantic view, read-only summary, or explicit desktop-required state.
- **UI-A11Y-016:** A mobile client never causes Node plugin deactivation. Unsupported UI affects
  only that client and preserves headless/background behavior.
- **UI-A11Y-017:** Sensitive and high-risk actions MAY be desktop-required by policy even when a
  mobile renderer can display them.

## Localization

- **UI-A11Y-018:** Host chrome and normative status/error text are localizable. Plugin strings use
  signed stable keys, default English and typed parameters; concatenated sentences are prohibited.
- **UI-A11Y-019:** Layout supports text expansion, right-to-left direction, locale date/number
  formatting and user time zone without changing canonical wire values.

## Acceptance

- **UI-A11Y-020:** Release tests include keyboard-only flows, screen-reader names/states, 200% zoom,
  reduced motion, high contrast, light/dark, right-to-left, long translations, all size classes and
  missing mobile capabilities for each contribution kind and standard renderer.
