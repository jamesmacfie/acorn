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
import Icon from '../../kit/components/Icon'
import Picker from '../../kit/components/Picker'
import PickerRow from '../../kit/components/PickerRow'
import Popover from '../../kit/components/Popover'
import CopyButton from '../../kit/components/CopyButton'
import MentionTextarea from '../../kit/components/MentionTextarea'
import Markdown from '../../kit/components/Markdown.tsx'
import { Menu } from '../../kit/components/Menu'
import { RowActions } from '../../kit/components/RowActions'
import { Fold } from '../../kit/components/Fold'
import { Composer } from '../../kit/components/Composer'
import { DocumentTabs } from '../../kit/components/DocumentTabs'
import { FindBar } from '../../kit/components/FindBar'
import { KeyValueEditor } from '../../kit/components/KeyValueEditor'
import { Modal } from '../../kit/components/Modal'
import { Tabs } from '../../kit/components/Tabs'
import { UserAvatar } from '../../kit/components/UserAvatar'
import { Stack } from '../../kit/components/Stack'
import { Text } from '../../kit/components/Text'
import { Inline } from '../../kit/components/Inline'
import { Heading } from '../../kit/components/Heading'
import { Section } from '../../kit/components/Section'
import { Timeline } from '../../kit/components/Timeline'
import { Facts } from '../../kit/components/Facts'
import { ChipRow } from '../../kit/components/ChipRow'
import { Log } from '../../kit/components/Log'
import { Grid } from '../../kit/components/Grid'
import { Rows } from '../../kit/components/Rows'
import { Only } from '../../kit/components/Only'
import { Fallback } from '../../kit/components/Fallback'
import { Rectangle } from '../../kit/components/Rectangle'
import { DiffLine, FileHead, NonCodeRow, SplitCell } from '../../kit/diff/DiffRows'
import { DiffPane } from '../../features/diff/DiffPane'
import ModelConnectionPicker from '../../features/settings/ModelConnectionPicker'

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
