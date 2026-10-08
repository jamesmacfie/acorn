const admitted = new Map<string, object>()
const key = (nodeId: string | null, taskId: string, path: string) => JSON.stringify([nodeId, taskId, path])

export function admitGraphicalEditor(nodeId: string | null, taskId: string, path: string): () => void {
  const address = key(nodeId, taskId, path)
  const owner = {}
  admitted.set(address, owner)
  return () => { if (admitted.get(address) === owner) admitted.delete(address) }
}

export function graphicalEditorAdmitted(nodeId: string | null, taskId: string, path: string): boolean {
  return admitted.has(key(nodeId, taskId, path))
}
