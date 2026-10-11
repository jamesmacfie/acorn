/** Keep a deferred linked-place import tied to the shell and Node that requested it. */
export function startLinkRequest<T>(request: {
  load: () => Promise<T>
  apply: (loaded: T) => void
  currentNodeId: () => string | null
  nodeId: string
  onError: (error: unknown) => void
}): () => void {
  let live = true
  void request
    .load()
    .then((loaded) => {
      if (live && request.currentNodeId() === request.nodeId) request.apply(loaded)
    })
    .catch((error: unknown) => {
      if (live && request.currentNodeId() === request.nodeId) request.onError(error)
    })
  return () => {
    live = false
  }
}
