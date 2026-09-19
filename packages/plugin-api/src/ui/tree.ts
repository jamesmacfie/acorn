// The tree path's rendering half: Solid compiled into acorn's own components instead of into a
// document, and the kit as nodes a plugin writes in JSX (docs/plugins.md § The tree contract).
//
// Its own entrypoint, beside ./ui/sdk rather than on it, for the reason ./ui/sdk states about
// frameworks: the bridge must stay loadable with no framework installed, and a Solid import on that
// barrel would end it. A plugin that draws a tree imports both — `mountTree` from ./ui/sdk, the
// nodes and `solidTree` from here — and points its JSX preset at this specifier:
//
//   solid({ solid: { generate: 'universal', moduleName: '@acorn/plugin-api/ui/tree' } })
export {
  solidTree, KIT_NODE_COMPONENTS,
  Stack, Inline, Section, Fold, Card, Timeline, Tabs, Toolbar, Modal, ModalBody,
  ModalActions, Menu, Popover, ListDetail, ListColumn, DetailColumn, SplitHandle, DocumentTabs,
  SectionHeader, TabPanel, ToolbarSpacer, Text, Link, Heading, Rows, Row, TreeRow, RowActions, Badge, Chip,
  ChipRow, StatusDot, Facts, DescriptionList, Table, TableHead, TableRow, TableCell, Grid, Meter, CodeBlock, Log, Markdown, DiffPane,
  DiffLine, FileHead,
  NonCodeRow, SplitCell, EmptyState, Alert, Spinner, Kbd, UserAvatar, Icon, Button, IconButton, Input, Textarea,
  Select, Checkbox, SegmentedControl, ToggleButton, Picker, PickerRow, Composer, MentionTextarea,
  KeyValueEditor, FindBar, Field, ConfirmButton, CopyButton, ModelBackendPicker, Rectangle, Only,
  Fallback,
} from '@acorn/client-core/host/frames/remoteSolid.ts'
// The universal-renderer surface. Solid's JSX preset emits calls to these by name; you do not write
// them, and their names are Solid's rather than acorn's.
export {
  render, effect, memo, createComponent, createElement, createTextNode, insertNode, insert, spread,
  setProp, mergeProps, use,
} from '@acorn/client-core/host/frames/remoteSolid.ts'
export type { KitNodeProps } from '@acorn/client-core/host/frames/remoteSolid.ts'
// The two-press delete, as a helper rather than a node. Here rather than on ./ui because that barrel is
// components compiled for a document, and a tree bundle must not pull one in: its own build compiles
// JSX into acorn's nodes, so a shell component reaching it would come out the far side as a tree.
export { createArmedConfirm } from '@acorn/client-core/kit/lib/confirm.ts'
// Which model a backend starts on, for a tree that draws a `ModelBackendPicker` node and has to
// seed it. A pure function, and its own module for exactly this reason.
export { defaultModelIdFor } from '@acorn/client-core/features/settings/models/defaultModel.ts'
