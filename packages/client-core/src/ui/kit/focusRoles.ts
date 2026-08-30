// What each kit node does with focus. Fixed by the kit; a plugin sets none of it.
//
// The same pattern as `support.ts` and `tokenAxes.ts`: the answer is data with a test behind it, so a
// node cannot join the kit without someone deciding whether a keyboard can land on it. See
// docs/future/layout/07-focus-and-keys.md § Focus is a property of the tree for the four values.
//
//   stop        one tab stop
//   collection  one tab stop with roving focus inside; the host owns `active`, `selected`, `offset`
//   item        an item inside a collection, never a stop of its own
//   trap        holds focus while open and hands it back to the opener on dismiss
//   none        not focusable
//
// `conditional` is the honest answer for the several nodes that are a stop only when they were given
// something to do: a `Card` with an `onPress`, a `Chip` with an `onRemove`, a `Fold`'s header.

import { NODE_SUPPORT, type KitNode } from './support'

export type FocusRole = 'stop' | 'collection' | 'item' | 'trap' | 'none' | 'conditional'

export const NODE_FOCUS = {
  // Grouping
  Stack: 'none',
  Inline: 'none',
  Section: 'conditional',
  Fold: 'stop',
  Card: 'conditional',
  Timeline: 'collection',
  Tabs: 'collection',
  Toolbar: 'none',
  Modal: 'trap',
  ModalBody: 'none',
  ModalActions: 'none',
  Menu: 'trap',
  Popover: 'none',
  ListDetail: 'none',
  ListColumn: 'none',
  DetailColumn: 'none',
  SplitHandle: 'stop',
  DocumentTabs: 'collection',
  SectionHeader: 'none',
  TabPanel: 'none',
  ToolbarSpacer: 'none',

  // Showing
  Text: 'none',
  Heading: 'none',
  Rows: 'collection',
  Row: 'item',
  TreeRow: 'item',
  RowActions: 'none',
  Badge: 'none',
  Chip: 'conditional',
  ChipRow: 'collection',
  StatusDot: 'none',
  Facts: 'none',
  DescriptionList: 'none',
  Table: 'none',
  Grid: 'collection',
  Meter: 'none',
  CodeBlock: 'none',
  Log: 'stop',
  Markdown: 'none',
  DiffPane: 'collection',
  DiffLine: 'item',
  FileHead: 'none',
  NonCodeRow: 'none',
  SplitCell: 'none',
  EmptyState: 'none',
  Alert: 'none',
  Spinner: 'none',
  Kbd: 'none',
  UserAvatar: 'none',
  Icon: 'none',

  // Asking
  Button: 'stop',
  // A stop, and the second press is the confirmation: the armed button IS the prompt.
  ConfirmButton: 'stop',
  Input: 'stop',
  Textarea: 'stop',
  Select: 'stop',
  Checkbox: 'stop',
  SegmentedControl: 'collection',
  ToggleButton: 'stop',
  Picker: 'stop',
  PickerRow: 'item',
  Composer: 'stop',
  MentionTextarea: 'stop',
  KeyValueEditor: 'collection',
  FindBar: 'stop',
  Field: 'none',
  CopyButton: 'stop',
  ModelConnectionPicker: 'stop',

  // Pixels. One stop from outside; Enter hands the keys to what is in the box and Escape takes them
  // back, because whatever is in there will swallow Tab.
  Rectangle: 'stop',

  // Host wrappers draw nothing of their own, so they inherit whatever they wrap.
  Only: 'none',
  Fallback: 'none',
} as const satisfies Record<KitNode, FocusRole>

/** The three nodes that own their keys while focused: everything typed reaches them, and only the
 *  typing-exempt intents get past. `isTypingTarget` in @acorn/protocol/keybindings.ts is the DOM host's form of this. */
export const OWNS_KEYS: readonly KitNode[] = ['Input', 'Textarea', 'Composer', 'MentionTextarea']

export const focusRole = (node: KitNode): FocusRole => NODE_FOCUS[node]

/** Every node the support matrix knows, so a test can walk both tables together. */
export const KIT_NODES = Object.keys(NODE_SUPPORT) as KitNode[]
