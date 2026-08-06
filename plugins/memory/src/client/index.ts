// The memory plugin's client part (docs/vNext/plugins.md § The plugin API).
//
// It did not exist until Phase 3, and the reason is worth keeping: this plugin HAD client code
// (MemorySection, memoryClient) but nothing registrable — its section rendered inside plugins/context's
// pane, which imported the component directly. A ClientPlugin then would have held an empty `init`, which
// phase2-notes.md called out as ceremony rather than a gap. The client context-section registry gave it
// something to register, and registering it is what removed the `context -> memory` boundary edge.
//
// Not `required`. A node with memory disabled loses the add-memory form and the proposal queue from the
// context pane; the pane itself, and every other section, is unaffected — which is exactly the degradation
// the registry is for. (The NODE half is `required`, for unrelated reasons its own file states.)
import type { ClientPlugin } from '@acorn/client-core/registries/plugin.ts'
import MemorySection from './MemorySection'

export const memoryClientPlugin: ClientPlugin = {
  name: 'memory',
  init: (ctx) => {
    // Under the node-side `memory` section, which plugins/memory's own node part registers. Both halves
    // key on the same id, and neither plugin names the other.
    ctx.contextSections.register({ id: 'memory.section', sectionId: 'memory', order: 10, component: MemorySection })
  },
}
