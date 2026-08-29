import type { Task } from '@acorn/plugin-api/client'

// The one place in the Context pane another plugin may draw: inside a section the node assembled,
// keyed by that section's id (docs/agent-tools.md § Context sections).
//
// This replaces the `contextSectionSlots` registry, which was a private seam with one consumer. It is
// the same idea said in the vocabulary every other cross-plugin surface uses, so memory's add form is
// now the same kind of thing as a third-party card, and a loaded plugin could put a tree here without
// context learning a second mechanism.
//
// The bare point id. `context:section` is what the host mints from it, and what a contributor names.
export const CONTEXT_SECTION_POINT = 'context:section'

/** What a contributor to a section is handed. The owner's own data, in the owner's words. */
export type ContextSectionProps = {
  task: Task
  // Re-fetch the assembled context. A contribution that mutates what a section reports (memory's add,
  // accept and reject) has to invalidate the inventory the pane is rendering, and only the pane owns
  // that fetch, hence a callback rather than the contribution reaching for the query itself.
  onChanged: () => void
  // How many not-yet-resolved items this contribution is holding, shown in the section header. Reported
  // upward rather than read downward, because the count lives in the contribution's own state.
  onPendingChange: (count: number) => void
}
