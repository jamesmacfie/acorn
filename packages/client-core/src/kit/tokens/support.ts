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
// Only `dom` is implemented. The `tui` column is documentation with a test that it is filled in, so
// a node cannot join the kit without someone deciding what it does on a host with no pixels.

export type Host = 'dom' | 'tui'
export type SupportLevel = 'full' | 'reduced' | 'fallback' | 'absent'

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
  Popover: { dom: 'full', tui: 'reduced' },
  ListDetail: { dom: 'full', tui: 'reduced' },
  // The columns as nodes, for a caller that cannot put an element in ListDetail's `list` prop.
  ListColumn: { dom: 'full', tui: 'reduced' },
  DetailColumn: { dom: 'full', tui: 'full' },
  SplitHandle: { dom: 'full', tui: 'absent' },
  DocumentTabs: { dom: 'full', tui: 'full' },
  SectionHeader: { dom: 'full', tui: 'full' },
  // The panel half of a tab strip, for the same reason ModalBody is a node.
  TabPanel: { dom: 'full', tui: 'full' },
  // The gap that pushes what follows to the far end of a toolbar.
  ToolbarSpacer: { dom: 'full', tui: 'full' },

  // Showing
  Text: { dom: 'full', tui: 'full' },
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
  Table: { dom: 'full', tui: 'reduced' },
  // Table's rows as nodes, for the reason ModalBody is one: a host cannot truncate columns it
  // receives as opaque DOM, so the promise above is only keepable if it can see the rows.
  TableHead: { dom: 'full', tui: 'reduced' },
  TableRow: { dom: 'full', tui: 'reduced' },
  TableCell: { dom: 'full', tui: 'reduced' },
  Grid: { dom: 'full', tui: 'reduced' },
  Meter: { dom: 'full', tui: 'full' },
  CodeBlock: { dom: 'full', tui: 'full' },
  Log: { dom: 'full', tui: 'full' },
  Markdown: { dom: 'full', tui: 'reduced' },
  DiffPane: { dom: 'full', tui: 'reduced' },
  DiffLine: { dom: 'full', tui: 'reduced' },
  FileHead: { dom: 'full', tui: 'reduced' },
  NonCodeRow: { dom: 'full', tui: 'reduced' },
  SplitCell: { dom: 'full', tui: 'absent' },
  EmptyState: { dom: 'full', tui: 'full' },
  Alert: { dom: 'full', tui: 'full' },
  Spinner: { dom: 'full', tui: 'reduced' },
  Kbd: { dom: 'full', tui: 'full' },
  UserAvatar: { dom: 'full', tui: 'reduced' },
  Icon: { dom: 'full', tui: 'reduced' },

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
  MentionTextarea: { dom: 'full', tui: 'reduced' },
  KeyValueEditor: { dom: 'full', tui: 'full' },
  FindBar: { dom: 'full', tui: 'full' },
  Field: { dom: 'full', tui: 'full' },
  CopyButton: { dom: 'full', tui: 'fallback' },
  ModelConnectionPicker: { dom: 'full', tui: 'full' },

  // Pixels. `absent` on a host with no pixels, and `kind="pty"` is the exception the node handles
  // itself: a terminal draws a PTY better than any of this does.
  Rectangle: { dom: 'full', tui: 'absent' },

  // Host wrappers. Both are host questions by definition, so both answer on every host.
  Only: { dom: 'full', tui: 'full' },
  Fallback: { dom: 'full', tui: 'full' },
} as const satisfies Record<string, Record<Host, SupportLevel>>

export type KitNode = keyof typeof NODE_SUPPORT

/** Which host this build draws to. One value today; the PWA is the same one, and a terminal
 *  renderer sets `tui`. `Only` and `Fallback` are the only things that read it. */
export const HOST: Host = 'dom'
