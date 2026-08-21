// What a manifest-declared task check actually does when the owner opens the archive dialog
// (docs/plugins.md § Task checks).
//
// The same move ./scheduleRun.ts makes, for the same reason: a loaded plugin declares its check as a
// route rather than as a function, because a manifest is data and a manifest is what the owner reads
// at install. So the node calls one of its own plugin routes with no client in sight: ./dispatch.ts,
// shared with schedules and the measure sampler.
//
// Neither half throws on a bad answer. A check that 500s or answers with nonsense has nothing to say
// about this task, which is exactly what a check that found nothing says, and the caller
// (./taskChecks.ts) already treats both as no row.
import type { Env } from '../../main/bindings'
import type { PluginTaskCheckDescriptor } from '@acorn/protocol/pluginContract.ts'
import type { TaskRef } from '../../main/core'
import { dispatchPluginRoute } from './dispatch'
import type { TaskConcern } from './taskChecks'

/** The task rides as a query parameter minted here, so a plugin route cannot see a task the host did
 *  not name. The rule `scopedContextPath` follows on the client for agent-context captures. */
const scopedPath = (path: string, taskId: string): string =>
  `${path}${path.includes('?') ? '&' : '?'}taskId=${encodeURIComponent(taskId)}`

/** Ask one manifest-declared check about one task. `null` for anything that is not a usable answer. */
export async function runPluginTaskCheck(
  env: Env,
  pluginId: string,
  descriptor: PluginTaskCheckDescriptor,
  task: TaskRef,
  signal: AbortSignal,
): Promise<TaskConcern | null> {
  const response = await dispatchPluginRoute(env, pluginId, scopedPath(descriptor.check, task.id), { method: 'GET' }, signal)
  if (!response.ok) {
    console.warn(`[task-check] ${pluginId}:${descriptor.id} answered ${response.status} from ${descriptor.check}`)
    return null
  }
  const body = await response.json().catch(() => null) as { concern?: unknown } | null
  // `{ concern: null }` and a bare `{}` both mean "nothing to say". The shape is checked properly by
  // the caller's sanitiser; this only has to decide whether there is an object to hand it.
  const concern = body?.concern
  return concern && typeof concern === 'object' ? concern as TaskConcern : null
}

/** Run one manifest-declared cleanup. Throws on a non-2xx, because the caller collects failures and
 *  the owner is entitled to hear that the cleanup they ticked did not happen. */
export async function runPluginTaskApply(
  env: Env,
  pluginId: string,
  path: string,
  task: TaskRef,
  signal: AbortSignal,
): Promise<void> {
  const response = await dispatchPluginRoute(env, pluginId, path, { method: 'POST', body: JSON.stringify({ taskId: task.id }) }, signal)
  if (!response.ok) throw new Error(`${response.status} from ${path}`)
}
