// Compiled-host UI only. See docs/plugins.md § The plugin API for the boundary between this and
// @acorn/plugin-api/ui: nothing here is safe to bundle into an isolated plugin frame.
export { registerKeybindings } from '@acorn/client-core/registries/keybindings.ts'
export { registerWillHandler } from '@acorn/client-core/registries/willPhase.tsx'
export type { Concern } from '@acorn/client-core/registries/willPhase.tsx'
// prune candidate: GitHub still mounts the whole shell while its source migration is completed.
export { default as Acorn } from '@acorn/client-core/Acorn.tsx'
// The palette chrome, deduped ×4. Host-only: palettes use the shell's focus machinery, and a
// sandboxed frame cannot open one.
export { PaletteSurface } from '@acorn/client-core/palette/PaletteSurface.tsx'
// The host's own "find or create a task for this reference" control, for a first-party reference
// panel to place in its own chrome. See docs/panes.md § Not a pane: the reference panel for why the
// host draws it, and does the write, rather than the panel.
export { default as RefPanelTaskLink } from '@acorn/client-core/registries/RefPanelTaskLink.tsx'
// A place in this surface where another plugin's tree may be grafted (docs/plugins.md § Cooperative
// extension points, the `remote` kind). Host-only for the same reason the palette is: it acquires a
// worker, wires a bridge and mounts the shell's own components. A plugin that owns a surface places
// this where it wants a contributor's UI; it never sees the contributor's nodes.
//
// `Slot` is what a surface owner reaches for. `RemoteTree` beside it is the one-contributor primitive
// underneath, exported for a host that has already resolved who draws.
export { Slot } from '@acorn/client-core/plugins/tree/Slot.tsx'
export type { SlotProps } from '@acorn/client-core/plugins/tree/Slot.tsx'
export { RemoteTree } from '@acorn/client-core/plugins/tree/RemoteTree.tsx'
export type { RemoteTreeProps } from '@acorn/client-core/plugins/tree/RemoteTree.tsx'
// Another plugin's rectangle, beside or below this one's pane (the `rectangle` kind). The iframe twin
// of `Slot`, for the surfaces that own pixels.
export { InlineSlot } from '@acorn/client-core/plugins/frames/InlineSlot.tsx'
