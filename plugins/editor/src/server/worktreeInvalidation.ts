import { invalidateWorktreeStatus } from '@acorn/plugin-api/node'
import type { EditorChanged, EditorCoreServices } from './editor'
import { canonicalCheckoutKey } from './fileWriteLock'

/** An event carries a task, not a path. Notify every active task already mapped to this same
 * checkout so another alias/device refreshes its tree, document, and Git projection. */
export async function editorWorktreeChanged(core: EditorCoreServices, root: string, taskId: string, changed: EditorChanged): Promise<void> {
  invalidateWorktreeStatus(root)
  changed(taskId)
  const key = await canonicalCheckoutKey(root).catch(() => null)
  if (!key) return
  for (const task of await core.tasks.active().catch(() => [])) {
    if (task.id === taskId || !task.worktreePath) continue
    if (await canonicalCheckoutKey(task.worktreePath).catch(() => null) === key) changed(task.id)
  }
}
