// Frame-safe components: props in and DOM out. See docs/plugins.md § The plugin API for the
// barrel and tier boundary this is held to.
//
// The diff toolkit sits on @acorn/plugin-api/ui/diff instead of here: it is a domain toolkit rather
// than a primitive, and its `Row` type would collide with the `Row` layout component below.
//
// Off this surface: ContributionBoundary (host machinery), IconPicker/iconNodes, WorkspacePicker,
// tokenAxes, focus.ts. No plugin imports them, and page-level components on a contract are how a
// design system stops being able to change.

export {
  Alert, Badge, Button, Card, Checkbox, Chip, CodeBlock, DescriptionList, EmptyState,
  Field, Input, Kbd, ListDetail, Meter, Row, SectionHeader, SegmentedControl, Select, Spinner,
  SplitHandle, StatusDot, Table, Textarea, ToggleButton, Toolbar, TreeRow,
} from '@acorn/client-core/ui/primitives.tsx'
export { default as Icon } from '@acorn/client-core/ui/Icon.tsx'
export { default as Picker } from '@acorn/client-core/ui/Picker.tsx'
export { default as Popover } from '@acorn/client-core/ui/Popover.tsx'
export { Menu } from '@acorn/client-core/ui/Menu.tsx'
export { CollapsibleSection } from '@acorn/client-core/ui/CollapsibleSection.tsx'
export { Composer } from '@acorn/client-core/ui/Composer.tsx'
export { DocumentTabs } from '@acorn/client-core/ui/DocumentTabs.tsx'
export { FindBar } from '@acorn/client-core/ui/FindBar.tsx'
export { KeyValueEditor } from '@acorn/client-core/ui/KeyValueEditor.tsx'
// Drag-resize as a hook, because the three consumers model size differently: two panes against each
// other, one absolute height, one fraction. Only a delta suits all three.
export { createSplitDrag } from '@acorn/client-core/ui/split.ts'
// The delegated tooltip protocol, as a typed helper. Attributes are the API; a wrapper component
// would add an element around every trigger, which is exactly what the protocol avoids.
export { tip } from '@acorn/client-core/ui/tips.tsx'
// A frame gets tooltips by mounting: `mountFrame` on ./ui/sdk calls the frame-side listener itself.
//
// Behavior that isn't a component ships as a hook, following the dismissable.ts precedent.
// Arm-to-confirm exists because a sandboxed frame's `window.confirm` silently returns false.
export { createArmedConfirm } from '@acorn/client-core/ui/confirm.ts'
export { default as CopyButton } from '@acorn/client-core/ui/CopyButton.tsx'
export { default as MentionTextarea } from '@acorn/client-core/ui/MentionTextarea.tsx'
export { Modal } from '@acorn/client-core/ui/Modal.tsx'
export { Tabs } from '@acorn/client-core/ui/Tabs.tsx'
export type { TabDef } from '@acorn/client-core/ui/Tabs.tsx'
export { UserAvatar } from '@acorn/client-core/ui/UserAvatar.tsx'
// Provider markdown to sanitized HTML. Also on ./client, which the compiled shell reaches it
// through. It is here too so a sandboxed frame rendering a ticket description does not pull in the
// router/query/apiClient half of ./client for one pure string function.
export { renderMarkdown } from '@acorn/client-core/integrations/markdown.ts'

// A density token as a number, on this barrel for the same reason as `renderMarkdown`: no imports,
// no state. A virtualized list cannot read its row height from CSS. @tanstack/solid-virtual needs a
// number and writes the result back as an inline style that beats any stylesheet rule. A frame gets
// the same tokens the shell does, pushed onto `:root` by the SDK, so a plugin's grid can honor a
// style pack's density instead of hardcoding 30.
export { rowHeightSm } from '@acorn/client-core/ui/metrics.ts'

// Controlled connection and model dropdowns over `availableModelConnections`. On this barrel because
// it is presentation only, a protocol type in and two selects out, and a plugin whose own route calls
// `core.models.generateText` needs to offer the picker from a frame.
export { default as ModelConnectionPicker, defaultModelIdFor } from '@acorn/client-core/modelProviders/ModelConnectionPicker.tsx'

// ── Diff rows ─────────────────────────────────────────────────────────────────────────────────
// The components of the diff toolkit; its model, virtualizer and find pass are on ./ui/diff.
export { DiffLine, FileHead, NonCodeRow, SplitCell } from '@acorn/client-core/ui/diff/DiffRows.tsx'
export type { LineComposerController, ThreadCollapseController } from '@acorn/client-core/ui/diff/DiffRows.tsx'
