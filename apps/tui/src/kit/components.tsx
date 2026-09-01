import type { Component } from 'solid-js'
import type { KitNodeName } from '@acorn/protocol/tree/nodes.ts'
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
  MentionTextarea, ModelConnectionPicker, Picker, PickerRow, SegmentedControl, Select, Textarea,
  ToggleButton,
} from './asking'
import { Fallback, Only, Rectangle } from './pixels'

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

// `Component<any>` and not a union of every node's props, for the reason the DOM table gives: the
// typing that matters is the key set, which is exhaustive.
// oxlint-disable-next-line no-explicit-any
type AnyKitComponent = Component<any>

export const KIT_COMPONENTS: Record<KitNodeName, AnyKitComponent> = {
  Stack, Inline, Section, Fold, Card, Timeline, Tabs, Toolbar,
  Modal, Menu, Popover, ListDetail, ListColumn, DetailColumn, Sections, SplitHandle, DocumentTabs, SectionHeader,
  // The compound halves, flattened: a node names one type, so `Modal.Body` and `Tabs.Panel` reach a
  // remote tree only under a name of their own.
  ModalBody, ModalActions, TabPanel, ToolbarSpacer,
  Text, Link, Heading, Rows, Row, TreeRow, RowActions, Badge, Chip, ChipRow, StatusDot, Facts,
  DescriptionList, Table, TableHead, TableRow, TableCell, Grid, Meter, CodeBlock, Log, Markdown, DiffPane, DiffLine,
  FileHead, NonCodeRow, SplitCell, EmptyState, Alert, Spinner, Kbd, UserAvatar, Icon,
  Button, Input, Textarea, Select, Checkbox, SegmentedControl, ToggleButton, Picker,
  PickerRow, Composer, MentionTextarea, KeyValueEditor, FindBar, Field, ConfirmButton, CopyButton,
  ModelConnectionPicker,
  Rectangle,
  Only, Fallback,
}
