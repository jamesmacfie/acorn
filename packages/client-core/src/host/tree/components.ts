// The kit, as a lookup from a name on the wire to the component that draws it.
//
// One import per node and no wildcard, for the same reason @acorn/protocol's exports are enumerated:
// adding a line is the decision. A node that is in the kit but not here is a build error, caught by
// the exhaustive type below and by `components.test.tsx`.
//
// The same components `@acorn/plugin-api/ui` re-exports, reached directly because this file is inside
// client-core. The direct render path uses the components; this path uses the same ones, which is what
// makes "one component API, two render paths" true rather than aspirational.
//
// An entry is a component or a loader (./kitEntry.ts). The heavy names are loaders, because this
// module is preloaded on every cold window — `RemoteTree` is ./Slot.tsx's fallback branch — and one
// static import of `DiffPane` used to put the diff viewer and the syntax highlighter in the first
// paint. Nothing under `features/` is reached statically from here any more, which is the property
// `components.test.ts` holds.
import type { AnyKitComponent, KitEntry, KitTable } from './kitEntry'
import {
  Alert, Badge, Button, Card, Checkbox, Chip, CodeBlock, ConfirmButton, DescriptionList, EmptyState,
  DetailColumn, Field, Input, Kbd, ListColumn, ListDetail, Meter, Row, SectionHeader,
  SegmentedControl, Select, Spinner, SplitHandle, StatusDot, Table, TableCell, TableHead, TableRow,
  Textarea, ToggleButton, Toolbar, TreeRow,
} from '../../kit/components/primitives'
import Icon from '../../kit/components/content/Icon'
import Picker from '../../kit/components/inputs/Picker'
import PickerRow from '../../kit/components/inputs/PickerRow'
import Popover from '../../kit/components/overlays/Popover'
import CopyButton from '../../kit/components/inputs/CopyButton'
import MentionTextarea from '../../kit/components/inputs/MentionTextarea'
import { Menu } from '../../kit/components/overlays/Menu'
import { RowActions } from '../../kit/components/layout/RowActions'
import { Fold } from '../../kit/components/layout/Fold'
import { Sections } from '../../kit/components/layout/Sections'
import { Composer } from '../../kit/components/inputs/Composer'
import { DocumentTabs } from '../../kit/components/layout/DocumentTabs'
import { FindBar } from '../../kit/components/inputs/FindBar'
import { KeyValueEditor } from '../../kit/components/inputs/KeyValueEditor'
import { Modal } from '../../kit/components/overlays/Modal'
import { Tabs } from '../../kit/components/layout/Tabs'
import { UserAvatar } from '../../kit/components/content/UserAvatar'
import { Stack } from '../../kit/components/layout/Stack'
import { Text } from '../../kit/components/content/Text'
import { Link } from '../../kit/components/content/Link'
import { Inline } from '../../kit/components/layout/Inline'
import { Heading } from '../../kit/components/content/Heading'
import { Section } from '../../kit/components/layout/Section'
import { Facts } from '../../kit/components/content/Facts'
import { ChipRow } from '../../kit/components/layout/ChipRow'
import { Log } from '../../kit/components/content/Log'
import { Grid } from '../../kit/components/layout/Grid'
import { Graph } from '../../kit/components/content/Graph'
import { Rows } from '../../kit/components/layout/Rows'
import { Only } from '../../kit/components/layout/Only'
import { Fallback } from '../../kit/components/content/Fallback'
import { Rectangle } from '../../kit/components/content/Rectangle'

// The eight loaders, and why each one is not a component.
//
//   - `DiffPane` reaches ../../features/diff and, through it, the syntax highlighter.
//   - The four diff rows share `kit/diff/DiffRows.tsx` with it, so leaving one eager keeps the chunk.
//   - `Markdown` fetches a grammar per fence at render time and is the surface a streaming transcript
//     re-renders; keeping it out of this table's chunk keeps the parser out of the first paint.
//   - `Timeline` carries the follow-scroll machinery.
//   - `ModelBackendPicker` reaches ../../features/settings.
//
// One line each and no internal comma, because `tools/arch/kitTable.test.ts` reads this literal as
// text: importing it there would pull a renderer into a node-env test.
const load = (loader: () => Promise<{ default: AnyKitComponent }>): KitEntry => ({ load: loader })

export const KIT_COMPONENTS: KitTable = {
  Stack, Inline, Section, Fold, Card, Tabs, Toolbar,
  Modal, Menu, Popover, ListDetail, ListColumn, DetailColumn, Sections, SplitHandle, DocumentTabs, SectionHeader,
  // The compound halves, flattened: a node names one type, so `Modal.Body` and `Tabs.Panel` reach a
  // remote tree only under a name of their own.
  ModalBody: Modal.Body, ModalActions: Modal.Actions, TabPanel: Tabs.Panel, ToolbarSpacer: Toolbar.Spacer,
  Text, Link, Heading, Rows, Row, TreeRow, RowActions, Badge, Chip, ChipRow, StatusDot, Facts,
  DescriptionList, Table, TableHead, TableRow, TableCell, Grid, Graph, Meter, CodeBlock, Log,
  EmptyState, Alert, Spinner, Kbd, UserAvatar, Icon,
  Button, Input, Textarea, Select, Checkbox, SegmentedControl, ToggleButton, Picker,
  PickerRow, Composer, MentionTextarea, KeyValueEditor, FindBar, Field, ConfirmButton, CopyButton,
  Rectangle,
  Only, Fallback,
  Timeline: load(() => import('../../kit/components/content/Timeline').then((m) => ({ default: m.Timeline }))),
  Markdown: load(() => import('../../kit/components/content/Markdown.tsx')),
  DiffPane: load(() => import('../../features/diff/DiffPane').then((m) => ({ default: m.DiffPane }))),
  DiffLine: load(() => import('../../kit/diff/DiffRows').then((m) => ({ default: m.DiffLine }))),
  FileHead: load(() => import('../../kit/diff/DiffRows').then((m) => ({ default: m.FileHead }))),
  NonCodeRow: load(() => import('../../kit/diff/DiffRows').then((m) => ({ default: m.NonCodeRow }))),
  SplitCell: load(() => import('../../kit/diff/DiffRows').then((m) => ({ default: m.SplitCell }))),
  ModelBackendPicker: load(() => import('../../features/settings/models/ModelBackendPicker')),
}
