// Published entry point for the tree path's renderer. Everything here re-exports
// @acorn/plugin-api/ui/tree, for the same reason ../index.ts re-exports @acorn/plugin-api/ui/sdk:
// this package cannot be allowed to drift from the facade the in-repo plugins compile against.
//
// Its own entrypoint, never the package's index: `acorn-plugin-sdk` must stay loadable in a bare Node
// test with no framework, and a Solid import on the main barrel would end that — a barrel evaluates
// every module on it.
//
// Your build, whole:
//
// ```ts
// // vite.config.ts
// solid({ solid: { generate: 'universal', moduleName: 'acorn-plugin-sdk/remote' } })
// ```
// ```tsx
// import { mountTree } from 'acorn-plugin-sdk'
// import { Card, Text, solidTree } from 'acorn-plugin-sdk/remote'
// mountTree({ toolCard: solidTree(ToolCard) })
// ```
export {
  solidTree, KIT_NODE_COMPONENTS,
  Stack, Inline, Section, Fold, Card, Timeline, Tabs, Toolbar, Modal, ModalBody,
  ModalActions, Menu, Popover, ListDetail, ListColumn, DetailColumn, SplitHandle, DocumentTabs,
  SectionHeader, TabPanel, ToolbarSpacer, Text, Heading, Rows, Row, TreeRow, RowActions, Badge, Chip,
  ChipRow, StatusDot, Facts, DescriptionList, Table, TableHead, TableRow, TableCell, Grid, Meter, CodeBlock, Log, Markdown, DiffPane,
  DiffLine, FileHead,
  NonCodeRow, SplitCell, EmptyState, Alert, Spinner, Kbd, UserAvatar, Icon, Button, Input, Textarea,
  Select, Checkbox, SegmentedControl, ToggleButton, Picker, PickerRow, Composer, MentionTextarea,
  KeyValueEditor, FindBar, Field, CopyButton, ModelConnectionPicker, Only, Fallback,
} from '@acorn/plugin-api/ui/tree'
export type { KitNodeProps } from '@acorn/plugin-api/ui/tree'
// The universal-renderer surface. Solid's JSX preset emits calls to these by name; you do not write
// them, and their names are Solid's rather than acorn's.
export {
  render, effect, memo, createComponent, createElement, createTextNode, insertNode, insert, spread,
  setProp, mergeProps, use,
} from '@acorn/plugin-api/ui/tree'
