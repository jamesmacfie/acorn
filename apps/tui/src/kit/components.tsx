import type { KitTable } from '@acorn/client-core/host/tree/kitEntry.ts'
import {
  Card, DetailColumn, DocumentTabs, Fold, Inline, ListColumn, ListDetail, Menu, Modal, ModalActions,
  ModalBody, Popover, Section, SectionHeader, Sections, SplitHandle, Stack, TabPanel, Tabs, Timeline,
  Toolbar,
  ToolbarSpacer,
} from './grouping'
import {
  Alert, Badge, ChipRow, Chip, CodeBlock, DescriptionList, DiffLine, DiffPane, EmptyState, Facts,
  FileHead, Grid, Heading, Icon, Kbd, Link, Log, Markdown, Meter, NonCodeRow, Row, RowActions, Rows,
  Spinner, SplitCell, StatusDot, Table, TableCell, TableHead, TableRow, Text, TreeRow, UserAvatar,
} from './showing'
import {
  Button, Checkbox, Composer, ConfirmButton, CopyButton, Field, FindBar, Input, KeyValueEditor,
  MentionTextarea, ModelBackendPicker, Picker, PickerRow, SegmentedControl, Select, Textarea,
  ToggleButton,
} from './asking'
import { Fallback, Only, Rectangle } from './pixels'
import { Graph } from './graph'

// The kit, as a lookup from a name to the component that draws it in cells. The terminal host's
// sibling of `client-core/host/tree/components.ts`, with the same key type and the same rule: one
// import per node and no wildcard, because adding a line is the decision.
//
// These are the same names, the same props and the same meanings as client-core's DOM kit. That is
// the whole test: a pane written against the kit imports `@acorn/plugin-api/ui`, and on this host that
// facade resolves to `./ui.ts`, which re-exports these. The pane does not change and does not know.
//
// What each one draws is the sentence in docs/ui-design.md § Every node at 80 by 24, and what a
// `reduced` one loses is written beside its level in client-core's kit/tokens/support.ts.
// `tools/arch/kitTable.test.ts` fails if this table, that matrix and that appendix disagree.

// Every entry is a component, and the DOM table's are not. `KitTable` allows either (client-core
// host/tree/kitEntry.ts) and the reason to reach for a loader is absent here: this table is not in
// this host's eager graph at all — `../plugins/RemoteTree.tsx` is lazy, so nothing below is fetched
// until a loaded plugin draws a tree — and the heavy nodes share `./showing.tsx` with the cheap ones,
// so a loader would cost a frame of blank and save no bytes. Splitting that file is the change that
// would make loaders worth having here, and nothing has asked for it.
export const KIT_COMPONENTS: KitTable = {
  Stack, Inline, Section, Fold, Card, Timeline, Tabs, Toolbar,
  Modal, Menu, Popover, ListDetail, ListColumn, DetailColumn, Sections, SplitHandle, DocumentTabs, SectionHeader,
  // The compound halves, flattened: a node names one type, so `Modal.Body` and `Tabs.Panel` reach a
  // remote tree only under a name of their own.
  ModalBody, ModalActions, TabPanel, ToolbarSpacer,
  Text, Link, Heading, Rows, Row, TreeRow, RowActions, Badge, Chip, ChipRow, StatusDot, Facts,
  DescriptionList, Table, TableHead, TableRow, TableCell, Grid, Graph, Meter, CodeBlock, Log, Markdown, DiffPane, DiffLine,
  FileHead, NonCodeRow, SplitCell, EmptyState, Alert, Spinner, Kbd, UserAvatar, Icon,
  Button, Input, Textarea, Select, Checkbox, SegmentedControl, ToggleButton, Picker,
  PickerRow, Composer, MentionTextarea, KeyValueEditor, FindBar, Field, ConfirmButton, CopyButton,
  ModelBackendPicker,
  Rectangle,
  Only, Fallback,
}
