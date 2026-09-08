// What `@acorn/plugin-api/ui` is on this host.
//
// A compiled pane reaches the kit through that one facade (docs/plugins.md § The plugin API), so
// pointing the facade here is the whole host switch for it: the pane's source is unchanged, its
// imports are unchanged, and a different component answers each name. `vite.config.ts` makes the swap
// for the bundle and `tsconfig.json`'s `paths` makes it for tsc.
//
// The names are the barrel's, in the barrel's order, and `support.test.ts` holds the two lists to
// being the same. A pane that names something missing here fails to build, which is this host's way
// of saying which node has not been drawn yet.
export {
  Card, DetailColumn, DocumentTabs, Fold, Inline, ListColumn, ListDetail, Menu, Modal, ModalActions,
  ModalBody, Popover, Section, SectionHeader, Sections, SplitHandle, Stack, TabPanel, Tabs, Timeline,
  Toolbar, ToolbarSpacer,
} from './grouping'
export {
  Alert, Badge, ChipRow, Chip, CodeBlock, DescriptionList, DiffLine, DiffPane, EmptyState, Facts,
  FileHead, Grid, Heading, Icon, Kbd, Link, Log, Markdown, Meter, NonCodeRow, Row, RowActions, Rows,
  Spinner, SplitCell, StatusDot, Table, TableCell, TableHead, TableRow, Text, TreeRow, UserAvatar,
} from './showing'
export {
  Button, Checkbox, Composer, ConfirmButton, CopyButton, Field, FindBar, Input, KeyValueEditor,
  MentionTextarea, ModelConnectionPicker, Picker, PickerRow, SegmentedControl, Select, Textarea,
  ToggleButton,
} from './asking'
export { Fallback, Only, Rectangle } from './pixels'
// The canvas, as the indented list. Its own file because it reaches into two of the three above.
export { Graph } from './graph'
export type { GraphCard } from '@acorn/client-core/kit/components/content/Graph.tsx'
export type { GraphEdgeRef, GraphPoint } from '@acorn/client-core/kit/lib/graphLayout.ts'
// The other half of a `pty` rectangle: the caller says what the channel is and the host draws the
// emulator. On the DOM that is an xterm on an element; here it is OpenTUI's, already drawn
// (./pty.ts, client-core/features/terminal/attachPty.ts).
export { attachPty } from './pty'
export type { PtyEvent, PtyIo } from '@acorn/client-core/kit/lib/pty.ts'
export type { ItemProps } from '../keys/collection'
// The prop-shape types a pane names in its own signatures. Types only, from the kit's own
// declarations, so the two hosts cannot disagree about what a node takes.
export type { ButtonProps, InputProps, SelectOption, SelectProps } from '@acorn/client-core/kit/components/primitives.tsx'
export type { PickerItem, PickerProps } from '@acorn/client-core/kit/components/inputs/Picker.tsx'
export type { KitSection } from '@acorn/client-core/kit/components/layout/Sections.tsx'
export type {
  MentionSegment, MentionSource, MentionSuggestion, MentionTextareaProps,
} from '@acorn/client-core/kit/components/inputs/MentionTextarea.tsx'

// Not components, and not the DOM ones either. Each is a rule rather than a rendering, and every rule
// here holds in cells: arming a button to confirm is a decision the reader makes twice, markdown to
// HTML is the shell's one policy (./markdown.ts draws what it decided), and a row height is a number
// a virtualiser needs on any host. Re-exported from the kit's own library, which is host-neutral.
export { createArmedConfirm } from '@acorn/client-core/kit/lib/confirm.ts'
import type { SplitDrag, SplitDragOptions } from '@acorn/client-core/kit/lib/split.ts'
export type { SplitDrag } from '@acorn/client-core/kit/lib/split.ts'
export { renderMarkdown } from '@acorn/client-core/kit/lib/markdown.ts'
export { clearLocal, deviceStorage, readLocal, writeLocal } from '@acorn/client-core/kit/lib/deviceStorage.ts'
export type { MarkdownOptions } from '@acorn/client-core/kit/lib/markdown.ts'
export { defaultModelIdFor } from '@acorn/client-core/features/settings/models/defaultModel.ts'

/**
 * Drag-to-resize, with nothing to drag.
 *
 * A pointer gesture, and this host has no pointer. What comes back is the same shape the caller
 * spreads onto its handle, and the handle is `SplitHandle`, which is `absent` in the matrix — so the
 * props reach a node that is not drawn and no callback ever fires. The split still moves: it moves by
 * a key, which is the layout's own business rather than the caller's (../layouts/split.ts).
 *
 * Present rather than absent, unlike the two below, because the caller is not asking for an
 * affordance — it is asking for a handle's props, and the honest answer to "what are the props of a
 * handle nobody can grab" is these.
 */
export function createSplitDrag(options: SplitDragOptions): SplitDrag {
  return {
    handleProps: {
      role: 'separator',
      'aria-orientation': options.axis === 'x' ? 'vertical' : 'horizontal',
      'aria-label': options.label,
      tabindex: 0,
      onPointerDown: () => {},
      onKeyDown: () => {},
    },
  }
}

// Two of the barrel's exports have no answer here and are absent rather than stubbed.
//
// `tip` is the delegated tooltip protocol, and hover is never load-bearing anywhere
// (docs/tui.md § What the TUI never does). `rowHeightSm` is a pixel count for
// a DOM virtualiser; `Rows` here counts lines instead. A pane that reaches for one fails to build,
// which is the answer we want: the affordance is gone, not silently broken.
