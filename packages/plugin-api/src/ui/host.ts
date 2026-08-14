// Compiled-host UI only. These exports subscribe to shell state, register into host registries, or
// mount app-level composition. They intentionally do not live on @acorn/plugin-api/ui: that surface
// is safe to bundle into an isolated plugin frame.
export { registerKeybindings } from '@acorn/client-core/registries/keybindings.ts'
export { registerWillHandler } from '@acorn/client-core/registries/willPhase.tsx'
export type { Concern } from '@acorn/client-core/registries/willPhase.tsx'
// Four names came off this surface in the prune pass (docs/plugins.md § The plugin API), each because its
// only consumer turned out to be core itself: `PromoteToTaskModal` (client-core's ChromeSourcePanel),
// `WorkspaceProjectAssignments` (apps/desktop's own page contributions, by direct import), and the
// `ModelConnectionPicker`/`defaultModelIdFor` pair, which was duplicated here "for the compiled panes
// that already import it from there" — no pane ever did, and it lives on ./ui, where a frame can reach it.
// Prune candidate: GitHub still mounts the whole shell while its source migration is completed.
export { default as Acorn } from '@acorn/client-core/Acorn.tsx'
// The palette chrome, deduped ×4. Host-only: palettes use the shell's focus machinery, and a
// sandboxed frame cannot open one.
export { PaletteSurface } from '@acorn/client-core/palette/PaletteSurface.tsx'
