// The components. Mostly the design system — pure presentation, props in and DOM out, held to that
// by a rule in tools/arch/boundaries.test.ts — plus the few surfaces that register into the running
// UI and the connected components a plugin composes with.
//
// Where the line falls between here and ./client is decided by the runtime, not by taste. Every
// entrypoint here is a barrel, so importing one member evaluates all of them, and Solid compiles a
// component to code that touches `window` at module scope. So the rule is mechanical: if it comes
// from a .tsx module it lands here, and ./client stays loadable from a plugin's node-environment
// test suite. That is why registerKeybindings and registerWillHandler sit on the design-system
// entrypoint, and why the design system's plain functions — cx, token, the metrics — sit on
// ./client.
//
// The diff toolkit sits on @acorn/plugin-api/ui/diff rather than here. It is a domain toolkit
// rather than a primitive, and it has a `Row` type that would collide with the `Row` layout
// component below.
//
// Not exported on purpose: ContributionBoundary (host machinery), IconPicker/iconNodes,
// WorkspacePicker, tokenAxes, focus.ts. No plugin imports them, and page-level components on a
// contract are how a design system stops being able to change.

export { Badge, Button, Field, Input, Row, SectionHeader, Select, Spinner, Textarea } from '@acorn/client-core/ui/primitives.tsx'
export { default as Icon } from '@acorn/client-core/ui/Icon.tsx'
export { default as Picker } from '@acorn/client-core/ui/Picker.tsx'
export { default as CopyButton } from '@acorn/client-core/ui/CopyButton.tsx'
export { default as MentionTextarea } from '@acorn/client-core/ui/MentionTextarea.tsx'
export { Modal } from '@acorn/client-core/ui/Modal.tsx'
export { Tabs } from '@acorn/client-core/ui/Tabs.tsx'
export type { TabDef } from '@acorn/client-core/ui/Tabs.tsx'
export { UserAvatar } from '@acorn/client-core/ui/UserAvatar.tsx'

// ── Diff rows ─────────────────────────────────────────────────────────────────────────────────
// The components of the diff toolkit; its model, virtualizer and find pass are on ./ui/diff.
export { DiffLine, FileHead, NonCodeRow, SplitCell } from '@acorn/client-core/ui/diff/DiffRows.tsx'
export type { LineComposerController, ThreadCollapseController } from '@acorn/client-core/ui/diff/DiffRows.tsx'

// ── Registration seams that live in a .tsx module ─────────────────────────────────────────────
export { registerKeybindings } from '@acorn/client-core/registries/keybindings.tsx'
export { registerWillHandler } from '@acorn/client-core/registries/willPhase.tsx'
export type { Concern } from '@acorn/client-core/registries/willPhase.tsx'

// ── Connected components a plugin composes with ───────────────────────────────────────────────
// Not design-system primitives: each one subscribes to core's data layer itself. They are here
// because a plugin renders them whole, and because they are components.
export { PromoteToTaskModal } from '@acorn/client-core/integrations/PromoteToTaskModal.tsx'
export { default as ModelConnectionPicker, defaultModelIdFor } from '@acorn/client-core/modelProviders/ModelConnectionPicker.tsx'
export { default as WorkspaceProjectAssignments } from '@acorn/client-core/workspaces/WorkspaceProjectAssignments.tsx'
// prune candidate: the whole shell, imported by github so a settings page can render inside it.
// That is a composition-root concern; a plugin should be contributing a page, not mounting Acorn.
export { default as Acorn } from '@acorn/client-core/Acorn.tsx'
