// What `@acorn/plugin-api/ui` is on this host.
//
// A compiled pane reaches the kit through that one facade (docs/plugins.md § The plugin API), so
// pointing the facade here is the whole host switch for it: the pane's source is unchanged, its
// imports are unchanged, and a different component answers each name. `vite.config.ts` makes the swap
// for the bundle and `tsconfig.json`'s `paths` makes it for tsc.
//
// Phase 0 exports the nodes the Notes pane spends. A pane that names anything else fails to build,
// which is the spike's own way of saying which node is missing; phase 1 replaces this with the full
// table and the test that says the two hosts draw the same kit and nothing else.
export {
  Alert, Button, Checkbox, EmptyState, Input, Markdown, Row, Rows, Section, Stack, Text, Textarea,
  ToggleButton, Toolbar, ToolbarSpacer,
} from './components'
export type { ItemProps } from './collection'

// Not a component, and not the DOM one either: arming a button to confirm is a rule about clicks the
// reader has to make twice, and it holds in cells. Re-exported from the kit's own library, which is
// host-neutral.
export { createArmedConfirm } from '@acorn/client-core/kit/lib/confirm.ts'
