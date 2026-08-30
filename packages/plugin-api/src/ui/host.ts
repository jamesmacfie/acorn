// Compiled-host UI only. See docs/plugins.md § The plugin API for the boundary between this and
// @acorn/plugin-api/ui: nothing here is safe to bundle into an isolated plugin frame.
export { registerKeybindings } from '@acorn/client-core/host/registries/commands/keybindings.ts'
export { registerWillHandler } from '@acorn/client-core/host/registries/shell/willPhase.tsx'
export type { Concern } from '@acorn/client-core/host/registries/shell/willPhase.tsx'
// The ASCII splash. A kit node in substance (no imports, props in), kept on the host surface because the
// onboarding overlay is its one plugin consumer.
export { default as Acorn } from '@acorn/client-core/kit/components/Acorn.tsx'
// The app's one bottom dock. Host-only, and not a kit node: where the rails are and how tall the top
// bar is are the shell's own geography, and its height is a pixel the drag handle produced, which is
// exactly what a kit node's props may not be (docs/ui-design.md § The closed kit).
export { Drawer } from '@acorn/client-core/kit/components/Drawer.tsx'
// The palette chrome, deduped ×4. Host-only: palettes use the shell's focus machinery, and a
// sandboxed frame cannot open one.
export { PaletteSurface } from '@acorn/client-core/host/palette/PaletteSurface.tsx'
// The box a reference panel is drawn in: backdrop, drawer, title, dismiss. Host-only, and the host's
// on purpose — a panel is a tree and the overlay around it is chrome every provider was redrawing.
export { default as RefPanelBox } from '@acorn/client-core/host/components/RefPanelBox.tsx'
// HTML a provider already rendered (GitHub's `bodyHTML`), in the host's markdown skin, with the
// bare-reference pass and link handling the host owns. Not a kit node: the pass is a registry
// function, and `ui/` may not import one.
export { default as ProviderHtml } from '@acorn/client-core/host/components/ProviderHtml.tsx'
// The host's own "find or create a task for this reference" control, for a first-party reference
// panel to place in its own chrome. See docs/panes.md § Not a pane: the reference panel for why the
// host draws it, and does the write, rather than the panel.
export { default as RefPanelTaskLink } from '@acorn/client-core/host/components/RefPanelTaskLink.tsx'
// A place in this surface where another plugin's tree may be grafted (docs/plugins.md § Cooperative
// extension points, the `remote` kind). Host-only for the same reason the palette is: it acquires a
// worker, wires a bridge and mounts the shell's own components. A plugin that owns a surface places
// this where it wants a contributor's UI; it never sees the contributor's nodes.
//
// `Slot` is what a surface owner reaches for. `RemoteTree` beside it is the one-contributor primitive
// underneath, exported for a host that has already resolved who draws.
export { Slot } from '@acorn/client-core/host/tree/Slot.tsx'
export type { SlotProps } from '@acorn/client-core/host/tree/Slot.tsx'
// "Is anyone offering to fill this?", for an owner that decides whether to draw the box at all.
export { slotFills } from '@acorn/client-core/host/tree/arbitration.ts'
export { RemoteTree } from '@acorn/client-core/host/tree/RemoteTree.tsx'
export type { RemoteTreeProps } from '@acorn/client-core/host/tree/RemoteTree.tsx'
// Marks other plugins pinned to the items this surface draws (the `annotation` kind). Two calls: ask
// about the keys on screen, and draw the answers at the site the owner chose. Host-only, like `Slot`:
// the fetch, the batching, the provenance stamp and the drawing are all the host's, and a plugin only
// says where its items are and what they are keyed by.
export { AnnotationMarks } from '@acorn/client-core/host/annotations/AnnotationMarks.tsx'
export { requestAnnotations, annotationsFor } from '@acorn/client-core/host/annotations/annotations.ts'

// The `wizard` layout, for a surface that is a wizard but is not a pane. Host-only: a layout is the
// host's arrangement, and a pane gets one by naming it on its contribution rather than by importing
// it (docs/panes.md § Layout model). Onboarding is the one surface that needs the arrangement without
// a pane to hang it on, because it lives in the `overlay` slot.
export { Wizard } from '@acorn/client-core/host/layouts/Wizard.tsx'
// Show one tab of a `tabs` pane. The selection is the host's, held under the pane id, so a pane whose
// panels point at each other asks rather than keeping a second copy (docs/panes.md § Layout model).
export { selectPaneTab } from '@acorn/client-core/host/layouts/state.ts'

// Another plugin's rectangle, beside or below this one's pane (the `rectangle` kind). The iframe twin
// of `Slot`, for the surfaces that own pixels.
export { InlineSlot } from '@acorn/client-core/host/frames/InlineSlot.tsx'
