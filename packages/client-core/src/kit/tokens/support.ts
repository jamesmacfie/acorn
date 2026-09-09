// Which host can draw which node, as data with a test behind it — the pattern `tokenAxes.ts` uses
// for "which axis owns this token". See docs/ui-design.md § The closed kit.
//
// Four levels, each with a defined behaviour, so an author can predict a host without running it:
//
//   full      same meaning, drawn natively
//   reduced   drawn, with named things missing; the node's row in docs/ui-design.md § The closed kit
//             says what
//   fallback  not drawn; the host draws a stated substitute, and the author does nothing
//   absent    nothing is drawn, unless the node has a <Fallback> child
//
// Both columns are implemented: the DOM host draws from `client-core/host/tree/components.ts`, the
// terminal host from `apps/tui/src/kit/components.tsx`. A node cannot join the kit without someone
// deciding what it does on a host with no pixels, and `tools/arch/kitTable.test.ts` fails if either
// host is missing a component for a row.
//
// A `reduced` node says what is lost, in the same place its level is decided, so an author reading
// this file knows what to expect without opening a doc. The sentence is the same one that ends the
// node's row in docs/ui-design.md § Every node at 80 by 24.

export type Host = 'dom' | 'tui'
export type SupportLevel = 'full' | 'reduced' | 'fallback' | 'absent'
/** A row: a level per host, and what a `reduced` level costs. */
export type NodeSupportRow = Record<Host, SupportLevel> & { loss?: string }

export const NODE_SUPPORT = {
  // Grouping
  Stack: { dom: 'full', tui: 'full' },
  Inline: { dom: 'full', tui: 'full' },
  Section: { dom: 'full', tui: 'full' },
  Fold: { dom: 'full', tui: 'full' },
  Card: { dom: 'full', tui: 'full' },
  Timeline: { dom: 'full', tui: 'full' },
  Tabs: { dom: 'full', tui: 'full' },
  Toolbar: { dom: 'full', tui: 'full' },
  Modal: { dom: 'full', tui: 'full' },
  // The two halves of a Modal as nodes rather than as `Modal.Body` and `Modal.Actions`: a remote tree
  // names one type per node and has nowhere to put the dot.
  ModalBody: { dom: 'full', tui: 'full' },
  ModalActions: { dom: 'full', tui: 'full' },
  Menu: { dom: 'full', tui: 'full' },
  Popover: {
    dom: 'full', tui: 'reduced',
    loss: 'the panel opens as a full-width block under its anchor, not floating',
  },
  ListDetail: {
    dom: 'full', tui: 'reduced',
    loss: 'two columns above 80 cells, one at a time below',
  },
  // The columns as nodes, for a caller that cannot put an element in ListDetail's `list` prop.
  ListColumn: {
    dom: 'full', tui: 'reduced',
    loss: 'the whole width when the split has collapsed, rather than a column beside the detail',
  },
  DetailColumn: { dom: 'full', tui: 'full' },
  // A header, its named sections, and the one region that gets the room. Two shapes for one
  // declaration, which is the node's whole reason to exist.
  Sections: {
    dom: 'full', tui: 'reduced',
    loss: 'the sections are a strip of tabs over one panel rather than folds beside the main region, and a section\'s `meta` is not drawn — a strip has room for a label and a count',
  },
  SplitHandle: { dom: 'full', tui: 'absent' },
  DocumentTabs: { dom: 'full', tui: 'full' },
  SectionHeader: { dom: 'full', tui: 'full' },
  // The panel half of a tab strip, for the same reason ModalBody is a node.
  TabPanel: { dom: 'full', tui: 'full' },
  // The gap that pushes what follows to the far end of a toolbar.
  ToolbarSpacer: { dom: 'full', tui: 'full' },

  // Showing
  Text: { dom: 'full', tui: 'full' },
  // Text that acts. `Text` is presentational and stays that way; the kit is one intent per node.
  Link: { dom: 'full', tui: 'full' },
  Heading: { dom: 'full', tui: 'full' },
  Rows: { dom: 'full', tui: 'full' },
  Row: { dom: 'full', tui: 'full' },
  TreeRow: { dom: 'full', tui: 'full' },
  RowActions: { dom: 'full', tui: 'full' },
  Badge: { dom: 'full', tui: 'full' },
  Chip: { dom: 'full', tui: 'full' },
  ChipRow: { dom: 'full', tui: 'full' },
  StatusDot: { dom: 'full', tui: 'full' },
  Facts: { dom: 'full', tui: 'full' },
  DescriptionList: { dom: 'full', tui: 'full' },
  Table: {
    dom: 'full', tui: 'reduced',
    loss: 'columns are truncated by the priority its heads declare',
  },
  // Table's rows as nodes, for the reason ModalBody is one: a host cannot truncate columns it
  // receives as opaque DOM, so the promise above is only keepable if it can see the rows.
  TableHead: {
    dom: 'full', tui: 'reduced',
    loss: 'the lowest priority column is dropped first, and the header names what was lost',
  },
  TableRow: {
    dom: 'full', tui: 'reduced',
    loss: 'cells are separated by │ and truncated by column priority',
  },
  TableCell: {
    dom: 'full', tui: 'reduced',
    loss: 'the text is ellipsised where its column does not fit',
  },
  Grid: {
    dom: 'full', tui: 'reduced',
    loss: 'a row-range indicator instead of a scrollbar, and the same column truncation as Table',
  },
  // The canvas. Ranks and lanes are a picture here and an indentation there, which is the whole of
  // what the terminal loses: the same cards, the same order, the same selection, no positions.
  Graph: {
    dom: 'full', tui: 'reduced',
    loss: 'the indented list the editor already draws — one line per card, no positions, no wires, and no dragging an edge into place',
  },
  Meter: { dom: 'full', tui: 'full' },
  CodeBlock: { dom: 'full', tui: 'full' },
  Log: { dom: 'full', tui: 'full' },
  Markdown: {
    dom: 'full', tui: 'reduced',
    loss: 'no images, and a link is its text with the URL beside it in dim',
  },
  DiffPane: {
    dom: 'full', tui: 'reduced',
    loss: 'unified only, and no syntax colour',
  },
  DiffLine: {
    dom: 'full', tui: 'reduced',
    loss: 'no intra-line word highlight',
  },
  FileHead: {
    dom: 'full', tui: 'reduced',
    loss: 'no per-file collapse control; the path and the counts only',
  },
  NonCodeRow: {
    dom: 'full', tui: 'reduced',
    loss: 'a dim line saying what is not being shown, with no control to act on it',
  },
  SplitCell: { dom: 'full', tui: 'absent' },
  EmptyState: { dom: 'full', tui: 'full' },
  Alert: { dom: 'full', tui: 'full' },
  Spinner: {
    dom: 'full', tui: 'reduced',
    loss: 'a braille cycle, or … where motion is off',
  },
  Kbd: { dom: 'full', tui: 'full' },
  UserAvatar: {
    dom: 'full', tui: 'reduced',
    loss: 'initials in brackets; no image',
  },
  Icon: {
    dom: 'full', tui: 'reduced',
    loss: 'a glyph from the name table, an emoji as itself, and nothing for a name with neither',
  },

  // Asking
  Button: { dom: 'full', tui: 'full' },
  ConfirmButton: { dom: 'full', tui: 'full' },
  Input: { dom: 'full', tui: 'full' },
  Textarea: { dom: 'full', tui: 'full' },
  Select: { dom: 'full', tui: 'full' },
  Checkbox: { dom: 'full', tui: 'full' },
  SegmentedControl: { dom: 'full', tui: 'full' },
  ToggleButton: { dom: 'full', tui: 'full' },
  Picker: { dom: 'full', tui: 'full' },
  PickerRow: { dom: 'full', tui: 'full' },
  Composer: { dom: 'full', tui: 'full' },
  MentionTextarea: {
    dom: 'full', tui: 'reduced',
    loss: 'no inline highlight of the completed token; the menu is a list under the field',
  },
  KeyValueEditor: { dom: 'full', tui: 'full' },
  FindBar: { dom: 'full', tui: 'full' },
  Field: { dom: 'full', tui: 'full' },
  CopyButton: { dom: 'full', tui: 'fallback' },
  ModelBackendPicker: { dom: 'full', tui: 'full' },

  // Pixels. `absent` on a host with no pixels, and `kind="pty"` is the exception the node handles
  // itself: a terminal draws a PTY better than any of this does.
  Rectangle: { dom: 'full', tui: 'absent' },

  // Host wrappers. Both are host questions by definition, so both answer on every host.
  Only: { dom: 'full', tui: 'full' },
  Fallback: { dom: 'full', tui: 'full' },
} as const satisfies Record<string, NodeSupportRow>

export type KitNode = keyof typeof NODE_SUPPORT

/** Which host this build draws to. Supplied by the host package at build time, because it is a fact
 *  about the bundle rather than about the run: the desktop's Vite config defines it as `dom`, the
 *  TUI's as `tui`. Where nothing defines it — a test, a plain browser served by a node — it is `dom`,
 *  which is what every host with a DOM is. `Only` and `Fallback` are the only things that read it.
 *
 *  `typeof` on an undeclared name is the one safe read in JavaScript, so this file needs no shim and
 *  no host has to remember to call a setter before the first render. */
declare const __ACORN_HOST__: Host
export const HOST: Host = typeof __ACORN_HOST__ === 'undefined' ? 'dom' : __ACORN_HOST__
