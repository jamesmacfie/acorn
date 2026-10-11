// Frame-safe components: props in and DOM out. See docs/plugins/plugin-api.md § The plugin API for the
// barrel and tier boundary this is held to.
//
// The diff toolkit sits on @acorn/plugin-api/ui/diff instead of here: it is a domain toolkit rather
// than a primitive, and its `Row` type would collide with the `Row` layout component below.
//
// Off this surface: ContributionBoundary (host machinery) and IconPicker. No plugin imports them, and
// page-level components on a contract are how a design system stops being able to change.

export {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Chip,
  CodeBlock,
  ConfirmButton,
  DescriptionList,
  EmptyState,
  DetailColumn,
  Field,
  FilterBar,
  Input,
  Kbd,
  ListColumn,
  ListDetail,
  Meter,
  Row,
  SectionHeader,
  SegmentedControl,
  Select,
  Spinner,
  SplitHandle,
  StatusDot,
  Table,
  TableCell,
  TableHead,
  TableRow,
  Textarea,
  ToggleButton,
  Toolbar,
  ToolbarSpacer,
  TreeRow,
} from '@acorn/client-core/kit/components/primitives.tsx'
export { default as Icon } from '@acorn/client-core/kit/components/content/Icon.tsx'
// The small square affordance: one mark, a required accessible name, and the bar's own size
// already chosen. Reach for this rather than a `Button` with `iconOnly` spelled out.
export { IconButton } from '@acorn/client-core/kit/components/inputs'
export { default as Picker } from '@acorn/client-core/kit/components/inputs/Picker.tsx'
// The row on its own, for a list that opens from typing rather than from Picker's trigger button.
export { default as PickerRow } from '@acorn/client-core/kit/components/inputs/PickerRow.tsx'
export { default as Popover } from '@acorn/client-core/kit/components/overlays'
export { Menu } from '@acorn/client-core/kit/components/overlays'
// The per-row overflow menu. Every list that offers a row-level action uses this rather than its own
// button, so the affordance sits in the same place and reveals on the same rules in a plugin's list as
// in a first-party one.
export { RowActions } from '@acorn/client-core/kit/components/layout'
export { Fold } from '@acorn/client-core/kit/components/layout'
// A header, its named sections, and the region they are about. One declaration, two shapes: folds
// beside a column here, a strip of tabs over one panel in a terminal.
export { Sections } from '@acorn/client-core/kit/components/layout'
export type { KitSection } from '@acorn/client-core/kit/components/layout'
export { Composer } from '@acorn/client-core/kit/components/inputs'
export { DocumentTabs } from '@acorn/client-core/kit/components/layout'
export { FindBar } from '@acorn/client-core/kit/components/inputs'
export { KeyValueEditor } from '@acorn/client-core/kit/components/inputs/KeyValueEditor.tsx'
// Drag-resize as a hook, because the three consumers model size differently: two panes against each
// other, one absolute height, one fraction. Only a delta suits all three.
export { createSplitDrag } from '@acorn/client-core/kit/lib'
// A collapsed sidebar is two decisions from one signal: the column's width, which `ListDetail` takes
// as `collapseKey`, and each row's rail form, which the pane passes as `Row`'s `collapsed` slot. Both
// read the state from here, because a row is created in the pane's own JSX and handed over as an
// element, so no provider inside the column could ever own it.
export { paneCollapseKey, sidebarCollapse, sidebarCollapsed } from '@acorn/client-core/kit/lib'
export { default as CopyButton } from '@acorn/client-core/kit/components/inputs/CopyButton.tsx'
export { copyText } from '@acorn/client-core/kit/lib'
// The field that completes what is typed after a sigil and colours what it has completed. `mentions`
// is the short form (one list of logins after `@`); `sources` and `segments` are the general one, and
// what the agents composer's `@file` / `/command` / `$skill` draft is written against.
export { default as MentionTextarea } from '@acorn/client-core/kit/components/inputs/MentionTextarea.tsx'
export type { MentionSegment, MentionSource } from '@acorn/client-core/kit/components/inputs/MentionTextarea.tsx'
export { Modal, ModalActions, ModalBody } from '@acorn/client-core/kit/components/overlays'
export { Tabs, TabPanel } from '@acorn/client-core/kit/components/layout'
export { UserAvatar } from '@acorn/client-core/kit/components/content'
// Provider markdown, sanitized, with a Shiki grammar per fence and a copy button on each.
export { default as Markdown } from '@acorn/client-core/kit/components/content/Markdown.tsx'

// Controlled connection and model dropdowns over `availableModelConnections`. On this barrel because
// it is presentation only, a protocol type in and two selects out, and a plugin whose own route calls
// `core.models.generateText` needs to offer the picker from a frame.
export { default as ModelBackendPicker } from '@acorn/client-core/features/settings/models/ModelBackendPicker.tsx'

// ── Diff rows ─────────────────────────────────────────────────────────────────────────────────
// The components of the diff toolkit; its model, virtualizer and find pass are on ./ui/diff.
export { DiffLine, FileHead, NonCodeRow, SplitCell, StackedDiff } from '@acorn/client-core/kit/diff/DiffRows.tsx'
// The whole viewer as one component: virtualized unified and split lists, find, sticky file header,
// per-file collapse, gap expansion, and the comment layer. Driven by a `DiffSource` from ./ui/diff.
// A plugin reaching for the row components directly is building a simpler surface than this one.
// StackedDiff is the read-only one already built: one file's patch shown inside something else.
export { DiffPane } from '@acorn/client-core/features/diff/DiffPane.tsx'

// ── Closed-kit nodes ──────────────────────────────────────────────────────────────────────────
// Each one covers a shape two or more panes would otherwise draw with raw tags and a private class. See
// docs/ui-design/closed-kit.md § The closed kit for the admission rule they had to pass, and
// @acorn/plugin-api/ui/tokens for the role enums their props take.
export { Stack } from '@acorn/client-core/kit/components/layout'
export { Inline } from '@acorn/client-core/kit/components/layout'
export { Text } from '@acorn/client-core/kit/components/content'
// Clickable words inside a sentence. `Text` has no press handler on purpose, so this is the node a
// pane reaches for when a run of its own text opens something.
export { Link } from '@acorn/client-core/kit/components/content'
export { Heading } from '@acorn/client-core/kit/components/content'
export { Section } from '@acorn/client-core/kit/components/layout'
// A settings page's titled group and its one setting: the label left, the control right, and the
// Saved signal, the error, Reset and a value set elsewhere drawn the same way on every page. The save
// helpers that drive them are on ./client (docs/frontend/settings.md § Settings).
export { SettingRow, SettingsSection } from '@acorn/client-core/kit/components/layout'
export { Timeline, type TimelineControls } from '@acorn/client-core/kit/components/content'
export type { ReadingPlace } from '@acorn/client-core/kit/lib'
// Which of a long timeline's turns to draw: the newest page, and more on "Show earlier". A rule, not a
// rendering, so both hosts share it (docs/managed-agents/transcript.md § The window).
export { createTimelineWindow } from '@acorn/client-core/kit/lib'
export { Facts } from '@acorn/client-core/kit/components/content'
export { ChipRow } from '@acorn/client-core/kit/components/layout'
export { Log } from '@acorn/client-core/kit/components/content'
export { Grid } from '@acorn/client-core/kit/components/layout/Grid.tsx'
// The canvas: cards on a grid, edges as curves, one card selected. A picture is exactly what a
// plugin may not draw for itself — no raw DOM, no SVG — so the kit draws it and the terminal host
// draws the same cards as an indented list. See docs/ui-design/closed-kit.md § The closed kit.
export { Graph } from '@acorn/client-core/kit/components/content'
export { HistoryMark, historyLayout } from '@acorn/client-core/kit/components/content'
export type { GraphCard } from '@acorn/client-core/kit/components/content'
// The container a run of `Row`s or `TreeRow`s lives in. It is what makes a list keyboard-operable:
// the arrows, Home, End, the page keys, type-ahead, `aria-activedescendant`, and a selection that
// survives a refetch all come from it, and the pane writes no key handling at all.
export { Rows } from '@acorn/client-core/kit/components/layout'

// The box the kit owns and something else fills with pixels: a PTY, a webview, a plugin's iframe.
// The kit's one admission that not everything is a tree, and the keyboard contract for getting in
// and out of one.
export { Rectangle } from '@acorn/client-core/kit/components/content'
// The other half of a `pty` rectangle. The caller says what the channel is (open at a size, bytes in,
// bytes out) and the host draws the emulator, so no plugin builds its own xterm on the element
// (docs/terminal/client.md § Client).
export { attachPty } from '@acorn/client-core/features/terminal/attachPty.ts'
export type { PtyIo } from '@acorn/client-core/kit/lib'

// The two host wrappers: `Only` is "this exists on these hosts", `Fallback` is "draw this instead where
// the node cannot be drawn".
export { Only } from '@acorn/client-core/kit/components/layout'
export { Fallback } from '@acorn/client-core/kit/components/content/Fallback.tsx'
