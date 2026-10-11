import { createEffect, onCleanup, type Accessor } from 'solid-js'
import { latestSignal } from '../../kit/lib/state/latestSignal'

/** An add can finish after its empty-screen component is replaced by the project's view. */
export function createProjectAddNavigation(input: {
  nodeId: Accessor<string | null>
  pathname: Accessor<string>
  settingsOpen: Accessor<boolean>
  openProject: (id: string) => void
}): () => (id: string) => void {
  // Where the reader is. Moving aborts an add begun from the old place.
  const place = latestSignal()
  let disposed = false
  createEffect(() => {
    input.nodeId()
    input.pathname()
    input.settingsOpen()
    place.next()
  })
  onCleanup(() => { disposed = true })

  return () => {
    const startedAt = place.signal
    const nodeId = input.nodeId()
    const pathname = input.pathname()
    const settingsOpen = input.settingsOpen()
    return (id) => {
      if (disposed || startedAt.aborted || input.nodeId() !== nodeId || input.pathname() !== pathname || input.settingsOpen() !== settingsOpen) return
      input.openProject(id)
    }
  }
}
