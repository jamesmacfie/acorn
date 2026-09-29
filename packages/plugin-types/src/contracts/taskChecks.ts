import type { HostOwned } from './shared.js'
import type { TaskRef } from './coreTasks.js'

/** What this plugin has to say when the owner archives a task, and the cleanup it can offer
 *  (docs/plugins.md § Task checks). */
export type PluginTaskCheckRegistry = {
  register(check: PluginTaskCheck): void
}

export type PluginTaskCheck = {
  /** Unique within the plugin, and stable: it is half of the id the client hands back to say which
   *  cleanups the owner accepted. */
  id: string
  /** `null` when there is nothing to say, which is the common case and has to stay cheap. */
  check(task: TaskRef, signal: AbortSignal): Promise<HostOwned<'protocol/api.TaskConcern'> | null>
  apply?(task: TaskRef, signal: AbortSignal): Promise<void>
}
