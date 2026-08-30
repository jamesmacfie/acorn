// Frame-safe components: props in and DOM out. See docs/plugins.md § The plugin API for the
// barrel and tier boundary this is held to.
//
// The diff toolkit sits on @acorn/plugin-api/ui/diff instead of here: it is a domain toolkit rather
// than a primitive, and its `Row` type would collide with the `Row` layout component below.
//
// Off this surface: ContributionBoundary (host machinery), IconPicker/iconNodes, WorkspacePicker,
// tokenAxes, focus.ts. No plugin imports them, and page-level components on a contract are how a
// design system stops being able to change.

export {
  Alert, Badge, Button, Card, Checkbox, Chip, CodeBlock, ConfirmButton, DescriptionList, EmptyState,
  DetailColumn, Field, Input, Kbd, ListColumn, ListDetail, Meter, Row, SectionHeader,
  SegmentedControl, Select, Spinner, SplitHandle, StatusDot, Table, Textarea, ToggleButton, Toolbar,
  ToolbarSpacer, TreeRow,
} from '@acorn/client-core/ui/primitives.tsx'
export { default as Icon } from '@acorn/client-core/ui/Icon.tsx'
export { default as Picker } from '@acorn/client-core/ui/Picker.tsx'
// The row on its own, for a list that opens from typing rather than from Picker's trigger button.
export { default as PickerRow } from '@acorn/client-core/ui/PickerRow.tsx'
export { default as Popover } from '@acorn/client-core/ui/Popover.tsx'
export { Menu } from '@acorn/client-core/ui/Menu.tsx'
// The per-row overflow menu. Every list that offers a row-level action ("Create task" today, more
// to come) uses this rather than its own button, so the affordance sits in the same place and
// reveals on the same rules in a plugin's list as in a first-party one.
export { RowActions } from '@acorn/client-core/ui/RowActions.tsx'
export { Fold } from '@acorn/client-core/ui/Fold.tsx'
export { Composer } from '@acorn/client-core/ui/Composer.tsx'
export { DocumentTabs } from '@acorn/client-core/ui/DocumentTabs.tsx'
export { FindBar } from '@acorn/client-core/ui/FindBar.tsx'
export { KeyValueEditor } from '@acorn/client-core/ui/KeyValueEditor.tsx'
// Drag-resize as a hook, because the three consumers model size differently: two panes against each
// other, one absolute height, one fraction. Only a delta suits all three.
export { createSplitDrag } from '@acorn/client-core/ui/split.ts'
// The delegated tooltip protocol, as a typed helper. Attributes are the API; a wrapper component
// would add an element around every trigger, which is exactly what the protocol avoids.
export { tip } from '@acorn/client-core/ui/tips.tsx'
// A frame gets tooltips by mounting: `mountFrame` on ./ui/sdk calls the frame-side listener itself.
//
// Behavior that isn't a component ships as a hook, following the dismissable.ts precedent.
// Arm-to-confirm exists because a sandboxed frame's `window.confirm` silently returns false.
export { createArmedConfirm } from '@acorn/client-core/ui/confirm.ts'
export { default as CopyButton } from '@acorn/client-core/ui/CopyButton.tsx'
// The field that completes what is typed after a sigil and colours what it has completed. `mentions`
// is the short form (one list of logins after `@`); `sources` and `segments` are the general one, and
// what the agents composer's `@file` / `/command` / `$skill` draft is written against.
export { default as MentionTextarea } from '@acorn/client-core/ui/MentionTextarea.tsx'
export type { MentionSegment, MentionSource, MentionSuggestion } from '@acorn/client-core/ui/MentionTextarea.tsx'
export { Modal, ModalActions, ModalBody } from '@acorn/client-core/ui/Modal.tsx'
export { Tabs, TabPanel } from '@acorn/client-core/ui/Tabs.tsx'
export type { TabDef } from '@acorn/client-core/ui/Tabs.tsx'
export { UserAvatar } from '@acorn/client-core/ui/UserAvatar.tsx'
// Provider markdown to sanitized HTML. Also on ./client, which the compiled shell reaches it
// through. It is here too so a sandboxed frame rendering a ticket description does not pull in the
// router/query/apiClient half of ./client for one pure string function.
export { renderMarkdown } from '@acorn/client-core/ui/markdown.ts'
export type { MarkdownOptions } from '@acorn/client-core/ui/markdown.ts'
// The component around it: the same sanitizing pass, plus a Shiki grammar per fence and a copy button
// on each. A call site that already holds HTML, or that needs a `ref` on the element, uses the
// `.ui-markdown` class and `renderMarkdown` instead.
export { default as Markdown } from '@acorn/client-core/ui/Markdown.tsx'

// A density token as a number, on this barrel for the same reason as `renderMarkdown`: no imports,
// no state. A virtualized list cannot read its row height from CSS. @tanstack/solid-virtual needs a
// number and writes the result back as an inline style that beats any stylesheet rule. A frame gets
// the same tokens the shell does, pushed onto `:root` by the SDK, so a plugin's grid can honor a
// style pack's density instead of hardcoding 30.
export { rowHeightSm } from '@acorn/client-core/ui/metrics.ts'

// Controlled connection and model dropdowns over `availableModelConnections`. On this barrel because
// it is presentation only, a protocol type in and two selects out, and a plugin whose own route calls
// `core.models.generateText` needs to offer the picker from a frame.
export { default as ModelConnectionPicker } from '@acorn/client-core/modelProviders/ModelConnectionPicker.tsx'
export { defaultModelIdFor } from '@acorn/client-core/modelProviders/defaultModel.ts'

// ── Diff rows ─────────────────────────────────────────────────────────────────────────────────
// The components of the diff toolkit; its model, virtualizer and find pass are on ./ui/diff.
export { DiffLine, FileHead, NonCodeRow, SplitCell } from '@acorn/client-core/ui/diff/DiffRows.tsx'
export type { LineComposerController, ThreadCollapseController } from '@acorn/client-core/ui/diff/DiffRows.tsx'
// The whole viewer as one component: virtualized unified and split lists, find, sticky file header,
// per-file collapse, gap expansion, and the comment layer. Driven by a `DiffSource` from ./ui/diff.
// A plugin reaching for the row components directly is building a simpler surface than this one, the
// way the compare preview does.
export { DiffPane } from '@acorn/client-core/diff/DiffPane.tsx'

// ── The nodes the kit gained when it closed ───────────────────────────────────────────────────
// Each one replaces a shape two or more panes were drawing with raw tags and a private class. See
// docs/ui-design.md § The closed kit for the admission rule they had to pass, and
// @acorn/plugin-api/ui/tokens for the role enums their props take.
export { Stack } from '@acorn/client-core/ui/Stack.tsx'
export { Inline } from '@acorn/client-core/ui/Inline.tsx'
export { Text } from '@acorn/client-core/ui/Text.tsx'
export { Heading } from '@acorn/client-core/ui/Heading.tsx'
export { Section } from '@acorn/client-core/ui/Section.tsx'
export { Timeline } from '@acorn/client-core/ui/Timeline.tsx'
export { Facts } from '@acorn/client-core/ui/Facts.tsx'
export { ChipRow } from '@acorn/client-core/ui/ChipRow.tsx'
export { Log } from '@acorn/client-core/ui/Log.tsx'
export { Grid } from '@acorn/client-core/ui/Grid.tsx'
// The container a run of `Row`s or `TreeRow`s lives in. It is what makes a list keyboard-operable:
// the arrows, Home, End, the page keys, type-ahead, `aria-activedescendant`, and a selection that
// survives a refetch all come from it, and the pane writes no key handling at all.
export { Rows } from '@acorn/client-core/ui/Rows.tsx'

// The box the kit owns and something else fills with pixels: a PTY, a webview, a plugin's iframe.
// The kit's one admission that not everything is a tree, and the keyboard contract for getting in
// and out of one.
export { Rectangle } from '@acorn/client-core/ui/Rectangle.tsx'

// The two host wrappers. Here before there is a second host, so a plugin can be written against one
// before it arrives: `Only` is "this exists on these hosts", `Fallback` is "draw this instead where
// the node cannot be drawn".
export { Only } from '@acorn/client-core/ui/Only.tsx'
export { Fallback } from '@acorn/client-core/ui/Fallback.tsx'
