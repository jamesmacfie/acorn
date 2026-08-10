// Compiled-host UI only. These exports subscribe to shell state, register into host registries, or
// mount app-level composition. They intentionally do not live on @acorn/plugin-api/ui: that surface
// is safe to bundle into an isolated plugin frame.
export { registerKeybindings } from '@acorn/client-core/registries/keybindings.tsx'
export { registerWillHandler } from '@acorn/client-core/registries/willPhase.tsx'
export type { Concern } from '@acorn/client-core/registries/willPhase.tsx'
export { PromoteToTaskModal } from '@acorn/client-core/integrations/PromoteToTaskModal.tsx'
export { default as ModelConnectionPicker, defaultModelIdFor } from '@acorn/client-core/modelProviders/ModelConnectionPicker.tsx'
export { default as WorkspaceProjectAssignments } from '@acorn/client-core/workspaces/WorkspaceProjectAssignments.tsx'
// Prune candidate: GitHub still mounts the whole shell while its source migration is completed.
export { default as Acorn } from '@acorn/client-core/Acorn.tsx'
