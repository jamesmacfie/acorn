// What `@acorn/plugin-api/ui` is on this host.
//
// A compiled pane reaches the kit through that one facade (docs/plugins/plugin-api.md § The plugin API), so
// pointing the facade here is the whole host switch for it: the pane's source is unchanged, its
// imports are unchanged, and a different component answers each name. `vite.config.ts` makes the swap
// for the bundle and `tsconfig.json`'s `paths` makes it for tsc.
//
// The names are the barrel's, in the barrel's order, and `support.test.ts` holds the two lists to
// being the same. A pane that names something missing here fails to build, which is this host's way
// of saying which node has not been drawn yet.
export {
  Card,
  DetailColumn,
  DocumentTabs,
  Fold,
  Inline,
  ListColumn,
  ListDetail,
  Menu,
  Modal,
  ModalActions,
  ModalBody,
  Popover,
  Section,
  SectionHeader,
  Sections,
  SettingRow,
  SettingsSection,
  SplitHandle,
  Pane,
  Stack,
  TabPanel,
  Tabs,
  Timeline,
  Toolbar,
  FilterBar,
  ToolbarSpacer,
} from './grouping'
export {
  Alert,
  Artwork,
  Badge,
  ChipRow,
  Chip,
  CodeBlock,
  DescriptionList,
  DiffLine,
  DiffPane,
  EmptyState,
  Facts,
  FileHead,
  Grid,
  Heading,
  Icon,
  Kbd,
  Link,
  Log,
  Markdown,
  Meter,
  NonCodeRow,
  Row,
  RowActions,
  Rows,
  Spinner,
  SplitCell,
  StackedDiff,
  StatusDot,
  Table,
  TableCell,
  TableHead,
  TableRow,
  Text,
  TreeRow,
  UserAvatar,
} from './showing'
export {
  Button,
  Checkbox,
  Composer,
  ConfirmButton,
  CopyButton,
  Field,
  FindBar,
  IconButton,
  Input,
  KeyValueEditor,
  MentionTextarea,
  ModelBackendPicker,
  Picker,
  PickerRow,
  SegmentedControl,
  Select,
  Textarea,
  ToggleButton,
} from './asking'
export { Fallback, Only, Rectangle } from './pixels'
import { copyToTerminal } from './copy'
/** OSC 52 where the terminal advertises support; otherwise the caller shows the path. */
export async function copyText(text: string): Promise<boolean> {
  return copyToTerminal(text)
}
// The canvas, as the indented list. Its own file because it reaches into two of the three above.
export { Graph } from './graph'
export { HistoryMark } from './historyMark'
export { historyLayout } from '@acorn/client-core/kit/components/content'
export type { GraphCard } from '@acorn/client-core/kit/components/content'
// The other half of a `pty` rectangle: the caller says what the channel is and the host draws the
// emulator. On the DOM that is an xterm on an element; here it is the rectangle's own, already drawn
// (./pty.ts, client-core/features/terminal/attachPty.ts).
export { attachPty } from './pty'
export type { PtyIo } from '@acorn/client-core/kit/lib'
export type { ItemProps } from '../keys/collection'
// The prop-shape types a pane names in its own signatures. Types only, from the kit's own
// declarations, so the two hosts cannot disagree about what a node takes.
export type { ButtonProps, InputProps, SelectProps } from '@acorn/client-core/kit/components/primitives.tsx'
export type { PickerItem, PickerProps } from '@acorn/client-core/kit/components/inputs/Picker.tsx'
export type { KitSection } from '@acorn/client-core/kit/components/layout'
export type { TimelineControls } from '@acorn/client-core/kit/components/content'
// The reading place is the DOM timeline's contract and a plain value, so both hosts hand back the
// same type even though this one never restores one (./grouping.tsx).
export type { ReadingPlace } from '@acorn/client-core/kit/lib'
// Which turns a long timeline draws. Counting, not measuring, so it holds in cells as it does on the DOM.
export { createTimelineWindow } from '@acorn/client-core/kit/lib'
export type {
  MentionSegment,
  MentionSource,
  MentionTextareaProps,
} from '@acorn/client-core/kit/components/inputs/MentionTextarea.tsx'

// Not components, and not the DOM ones either. Each is a rule rather than a rendering, and every rule
// here holds in cells. Re-exported from the kit's own library, which is host-neutral.
import type { SplitDrag, SplitDragOptions } from '@acorn/client-core/kit/lib'
export type { SplitDrag } from '@acorn/client-core/kit/lib'
export { clearLocal, deviceStorage, readLocal, writeLocal } from '@acorn/client-core/kit/lib'

// The collapsed-sidebar signal, re-exported as it stands rather than stubbed. It reads device
// storage, which this host does not have (client-core/kit/lib/state/deviceStorage.ts), so it answers
// `false` for every sidebar and every pane that shares its code draws the full column. Nothing here
// can set it either: `ListDetail` ignores `collapseKey` and never draws the toggle. A stub returning
// `false` would be the same answer with a second implementation to keep in step.
export { paneCollapseKey, sidebarCollapse, sidebarCollapsed } from '@acorn/client-core/kit/lib'

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
