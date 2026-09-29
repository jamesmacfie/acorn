import { createContext, onCleanup, useContext, type Accessor } from 'solid-js'

// A settings form with Save and Cancel holds changes nothing has written yet: a custom agent, a
// credential, an MCP server, a new schedule. Leaving settings, or its page, would drop them without a
// word. So a form says whether it holds any, and the settings view asks before any way off the page:
// another page, Back to acorn, Escape, the palette, or a deep link (./SettingsView.tsx § leave).
//
// A context rather than a registry, so a form outside settings, such as the same editor opened from a
// pane, registers with nothing and costs nothing.

export type UnsavedChanges = {
  /** Count `dirty` while the calling component is mounted. */
  register: (dirty: Accessor<boolean>) => void
  /** Whether any registered form holds changes. */
  dirty: () => boolean
}

export function createUnsavedChanges(): UnsavedChanges {
  const forms = new Set<Accessor<boolean>>()
  return {
    register: (dirty) => {
      forms.add(dirty)
      onCleanup(() => forms.delete(dirty))
    },
    dirty: () => [...forms].some((dirty) => dirty()),
  }
}

export const UnsavedChangesContext = createContext<UnsavedChanges>()

/** Tell settings this form holds unsaved changes while `dirty()` is true. Call it once, from the form's
 *  component, with the comparison between what is typed and what is stored. */
export function useUnsavedChanges(dirty: Accessor<boolean>): void {
  useContext(UnsavedChangesContext)?.register(dirty)
}
