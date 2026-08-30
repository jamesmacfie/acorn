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
} from '../../ui/primitives'
import Icon from '../../ui/Icon'
import Picker from '../../ui/Picker'
import PickerRow from '../../ui/PickerRow'
import Popover from '../../ui/Popover'
import CopyButton from '../../ui/CopyButton'
import MentionTextarea from '../../ui/MentionTextarea'
import Markdown from '../../ui/Markdown.tsx'
import { Menu } from '../../ui/Menu'
import { RowActions } from '../../ui/RowActions'
import { Fold } from '../../ui/Fold'
import { Composer } from '../../ui/Composer'
import { DocumentTabs } from '../../ui/DocumentTabs'
import { FindBar } from '../../ui/FindBar'
import { KeyValueEditor } from '../../ui/KeyValueEditor'
import { Modal } from '../../ui/Modal'
import { Tabs } from '../../ui/Tabs'
import { UserAvatar } from '../../ui/UserAvatar'
import { Stack } from '../../ui/Stack'
import { Text } from '../../ui/Text'
import { Inline } from '../../ui/Inline'
import { Heading } from '../../ui/Heading'
import { Section } from '../../ui/Section'
import { Timeline } from '../../ui/Timeline'
import { Facts } from '../../ui/Facts'
import { ChipRow } from '../../ui/ChipRow'
import { Log } from '../../ui/Log'
import { Grid } from '../../ui/Grid'
import { Rows } from '../../ui/Rows'
import { Only } from '../../ui/Only'
import { Fallback } from '../../ui/Fallback'
import { Rectangle } from '../../ui/Rectangle'
import { DiffLine, FileHead, NonCodeRow, SplitCell } from '../../ui/diff/DiffRows'
import { DiffPane } from '../../diff/DiffPane'
import ModelConnectionPicker from '../../modelProviders/ModelConnectionPicker'

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
