// What `@acorn/plugin-api/ui` is on this host.
//
// A compiled pane reaches the kit through that one facade (docs/plugins.md § The plugin API), so
// pointing the facade here is the whole host switch for it: the pane's source is unchanged, its
// imports are unchanged, and a different component answers each name. `vite.config.ts` makes the swap
// for the bundle and `tsconfig.json`'s `paths` makes it for tsc.
//
// The names are the barrel's, in the barrel's order, and `support.test.ts` holds the two lists to
// being the same. A pane that names something missing here fails to build, which is this host's way
// of saying which node has not been drawn yet.
export {
  Card, DetailColumn, DocumentTabs, Fold, Inline, ListColumn, ListDetail, Menu, Modal, ModalActions,
  ModalBody, Popover, Section, SectionHeader, SplitHandle, Stack, TabPanel, Tabs, Timeline, Toolbar,
  ToolbarSpacer,
} from './grouping'
export {
  Alert, Badge, ChipRow, Chip, CodeBlock, DescriptionList, DiffLine, DiffPane, EmptyState, Facts,
  FileHead, Grid, Heading, Icon, Kbd, Link, Log, Markdown, Meter, NonCodeRow, Row, RowActions, Rows,
  Spinner, SplitCell, StatusDot, Table, TableCell, TableHead, TableRow, Text, TreeRow, UserAvatar,
} from './showing'
export {
  Button, Checkbox, Composer, ConfirmButton, CopyButton, Field, FindBar, Input, KeyValueEditor,
  MentionTextarea, ModelConnectionPicker, Picker, PickerRow, SegmentedControl, Select, Textarea,
  ToggleButton,
} from './asking'
export { Fallback, Only, Rectangle } from './pixels'
export type { ItemProps } from '../keys/collection'

// Not components, and not the DOM ones either. Each is a rule rather than a rendering, and every rule
// here holds in cells: arming a button to confirm is a decision the reader makes twice, markdown to
// HTML is the shell's one policy (./markdown.ts draws what it decided), and a row height is a number
// a virtualiser needs on any host. Re-exported from the kit's own library, which is host-neutral.
export { createArmedConfirm } from '@acorn/client-core/kit/lib/confirm.ts'
export { renderMarkdown } from '@acorn/client-core/kit/lib/markdown.ts'
export type { MarkdownOptions } from '@acorn/client-core/kit/lib/markdown.ts'
export { defaultModelIdFor } from '@acorn/client-core/features/settings/models/defaultModel.ts'

// Two of the barrel's exports have no answer here and are absent rather than stubbed.
//
// `createSplitDrag` is a pointer gesture; a terminal split moves by a key, which is why `SplitHandle`
// is `absent` in the matrix. `tip` is the delegated tooltip protocol, and hover is never load-bearing
// anywhere (docs/future/terminal/04-rendering.md § What the TUI never does). `rowHeightSm` is a
// pixel count for a DOM virtualiser; `Rows` here counts lines instead. A pane that reaches for one
// fails to build, which is the answer we want: the affordance is gone, not silently broken.
