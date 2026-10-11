// The one place in the Context pane another plugin may draw: inside a section the node assembled,
// keyed by that section's id (docs/agent-tools/context-sections.md § Context sections).
//
// An extension point, the vocabulary every other cross-plugin surface uses, so memory's add form is the
// same kind of thing as a third-party card, and a loaded plugin can put a tree here without context
// learning a second mechanism.
//
// The bare point id. `context:section` is what the host mints from it, and what a contributor names.
export const CONTEXT_SECTION_POINT = 'context:section'
