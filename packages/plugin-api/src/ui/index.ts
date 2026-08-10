// Frame-safe components: the design system is pure presentation, props in and DOM out, held to that
// by a rule in tools/arch/boundaries.test.ts. Host registrations and connected components live on
// ./host so importing this barrel in an isolated frame cannot pull shell state/router/query modules.
//
// Where the line falls between here and ./client is decided by the runtime, not by taste. Every
// entrypoint here is a barrel, so importing one member may evaluate modules in its surface. The
// package is marked side-effect-free so bundlers can retain only the components a frame actually
// imports; ./client remains loadable from a plugin's node-environment test suite.
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
