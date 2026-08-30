// The kit, as a lookup from a name on the wire to the component that draws it.
//
// One import per node and no wildcard, for the same reason @acorn/protocol's exports are enumerated:
// adding a line is the decision. A node that is in the kit but not here is a build error, caught by
// the exhaustive type below and by `components.test.ts`.
//
// The same components `@acorn/plugin-api/ui` re-exports, reached directly because this file is inside
// client-core. The direct render path uses the components; this path uses the same ones, which is what
// makes "one component API, two render paths" true rather than aspirational.
import type { Component } from 'solid-js'
import type { KitNodeName } from '@acorn/protocol/tree/nodes.ts'
import {
  Alert, Badge, Button, Card, Checkbox, Chip, CodeBlock, ConfirmButton, DescriptionList, EmptyState,
  DetailColumn, Field, Input, Kbd, ListColumn, ListDetail, Meter, Row, SectionHeader,
  SegmentedControl, Select, Spinner, SplitHandle, StatusDot, Table, Textarea, ToggleButton, Toolbar,
  TreeRow,
} from '../../kit/components/primitives'
import Icon from '../../kit/components/content/Icon'
import Picker from '../../kit/components/inputs/Picker'
import PickerRow from '../../kit/components/inputs/PickerRow'
import Popover from '../../kit/components/overlays/Popover'
import CopyButton from '../../kit/components/inputs/CopyButton'
import MentionTextarea from '../../kit/components/inputs/MentionTextarea'
import Markdown from '../../kit/components/content/Markdown.tsx'
import { Menu } from '../../kit/components/overlays/Menu'
import { RowActions } from '../../kit/components/layout/RowActions'
import { Fold } from '../../kit/components/layout/Fold'
import { Composer } from '../../kit/components/inputs/Composer'
import { DocumentTabs } from '../../kit/components/layout/DocumentTabs'
import { FindBar } from '../../kit/components/inputs/FindBar'
import { KeyValueEditor } from '../../kit/components/inputs/KeyValueEditor'
import { Modal } from '../../kit/components/overlays/Modal'
import { Tabs } from '../../kit/components/layout/Tabs'
import { UserAvatar } from '../../kit/components/content/UserAvatar'
import { Stack } from '../../kit/components/layout/Stack'
import { Text } from '../../kit/components/content/Text'
import { Inline } from '../../kit/components/layout/Inline'
import { Heading } from '../../kit/components/content/Heading'
import { Section } from '../../kit/components/layout/Section'
import { Timeline } from '../../kit/components/content/Timeline'
import { Facts } from '../../kit/components/content/Facts'
import { ChipRow } from '../../kit/components/layout/ChipRow'
import { Log } from '../../kit/components/content/Log'
import { Grid } from '../../kit/components/layout/Grid'
import { Rows } from '../../kit/components/layout/Rows'
import { Only } from '../../kit/components/layout/Only'
import { Fallback } from '../../kit/components/content/Fallback'
import { Rectangle } from '../../kit/components/content/Rectangle'
import { DiffLine, FileHead, NonCodeRow, SplitCell } from '../../kit/diff/DiffRows'
import { DiffPane } from '../../features/diff/DiffPane'
import ModelConnectionPicker from '../../features/settings/models/ModelConnectionPicker'

// `Component<any>` and not a union of every node's props: the renderer has already validated the
// props against the wire schema, and a union of 62 prop types would make every mount site an
// unresolvable overload. The typing that matters is the key set, which is exhaustive.
// oxlint-disable-next-line no-explicit-any
type AnyKitComponent = Component<any>

export const KIT_COMPONENTS: Record<KitNodeName, AnyKitComponent> = {
  Stack, Inline, Section, Fold, Card, Timeline, Tabs, Toolbar,
  Modal, Menu, Popover, ListDetail, ListColumn, DetailColumn, SplitHandle, DocumentTabs, SectionHeader,
  // The compound halves, flattened: a node names one type, so `Modal.Body` and `Tabs.Panel` reach a
  // remote tree only under a name of their own.
  ModalBody: Modal.Body, ModalActions: Modal.Actions, TabPanel: Tabs.Panel, ToolbarSpacer: Toolbar.Spacer,
  Text, Heading, Rows, Row, TreeRow, RowActions, Badge, Chip, ChipRow, StatusDot, Facts,
  DescriptionList, Table, Grid, Meter, CodeBlock, Log, Markdown, DiffPane, DiffLine,
  FileHead, NonCodeRow, SplitCell, EmptyState, Alert, Spinner, Kbd, UserAvatar, Icon,
  Button, Input, Textarea, Select, Checkbox, SegmentedControl, ToggleButton, Picker,
  PickerRow, Composer, MentionTextarea, KeyValueEditor, FindBar, Field, ConfirmButton, CopyButton,
  ModelConnectionPicker,
  Rectangle,
  Only, Fallback,
}
