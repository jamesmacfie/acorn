import { createEffect, onCleanup, type Accessor } from 'solid-js'

/** An add can finish after its empty-screen component is replaced by the project's view. */
export function createProjectAddNavigation(input: {
  nodeId: Accessor<string | null>
  pathname: Accessor<string>
  settingsOpen: Accessor<boolean>
  openProject: (id: string) => void
}): () => (id: string) => void {
  let revision = 0
  let disposed = false
  createEffect(() => {
    input.nodeId()
    input.pathname()
    input.settingsOpen()
    revision++
  })
  onCleanup(() => { disposed = true })

  return () => {
    const startedAt = revision
    const nodeId = input.nodeId()
    const pathname = input.pathname()
    const settingsOpen = input.settingsOpen()
    return (id) => {
      if (disposed || revision !== startedAt || input.nodeId() !== nodeId || input.pathname() !== pathname || input.settingsOpen() !== settingsOpen) return
      input.openProject(id)
    }
  }
}
