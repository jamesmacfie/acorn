// Compiled-host UI only. See docs/plugins.md § The plugin API for the boundary between this and
// @acorn/plugin-api/ui: nothing here is safe to bundle into an isolated plugin frame.
export { registerKeybindings } from '@acorn/client-core/registries/keybindings.ts'
export { registerWillHandler } from '@acorn/client-core/registries/willPhase.tsx'
export type { Concern } from '@acorn/client-core/registries/willPhase.tsx'
// Four names came off this surface in the prune pass (docs/plugins.md § The plugin API), each
// because its only consumer turned out to be core itself: PromoteToTaskModal (client-core's
// ChromeSourcePanel), WorkspaceProjectAssignments (apps/desktop's own page contributions, by direct
// import), and the ModelConnectionPicker/defaultModelIdFor pair, duplicated here for compiled panes
// that were supposed to import it from there. No pane ever did; it lives on ./ui now, where a frame
// can reach it too.
//
// prune candidate: GitHub still mounts the whole shell while its source migration is completed.
export { default as Acorn } from '@acorn/client-core/Acorn.tsx'
// The palette chrome, deduped ×4. Host-only: palettes use the shell's focus machinery, and a
// sandboxed frame cannot open one.
export { PaletteSurface } from '@acorn/client-core/palette/PaletteSurface.tsx'
// The host's own "find or create a task for this reference" control, for a first-party reference
// panel to place in its own chrome. See docs/panes.md § Not a pane: the reference panel for why the
// host draws it, and does the write, rather than the panel.
export { default as RefPanelTaskLink } from '@acorn/client-core/registries/RefPanelTaskLink.tsx'
