import type { ClientPlugin } from '@acorn/client-core/host/registries/extensionPoints'

type PluginStartupOptions = {
  load: () => Promise<readonly ClientPlugin[]>
  register: (plugins: readonly ClientPlugin[], disabled: readonly string[]) => void
  refresh: (nodeId: string) => Promise<readonly string[] | null>
  activeNode: () => string | null
  disabled: () => readonly string[]
  onReady: () => void
}

/** Registration follows the first shell paint. Node applications wait for it and only commit to
 * the node still on screen; an unanswered roster remains retryable. */
export function createPluginStartup(options: PluginStartupOptions) {
  let start: Promise<readonly ClientPlugin[]> | undefined
  let release: () => void = () => {}
  const started = new Promise<void>((resolve) => { release = resolve })
  let applied: string | null = null
  const pending = new Map<string, Promise<void>>()

  const initialize = (): Promise<readonly ClientPlugin[]> => {
    if (!start) {
      start = options.load().then((plugins) => {
        options.register(plugins, options.disabled())
        options.onReady()
        return plugins
      })
      release()
    }
    return start
  }

  const apply = (nodeId: string): Promise<void> => {
    if (applied === nodeId && options.activeNode() === nodeId) return Promise.resolve()
    const existing = pending.get(nodeId)
    if (existing) return existing
    const pass = async (): Promise<void> => {
      await started
      const plugins = await start!
      if (options.activeNode() !== nodeId) return
      const disabled = await options.refresh(nodeId)
      if (options.activeNode() !== nodeId) return
      options.register(plugins, disabled ?? options.disabled())
      applied = disabled !== null ? nodeId : null
    }
    const result = pass().finally(() => { pending.delete(nodeId) })
    pending.set(nodeId, result)
    return result
  }

  return { initialize, apply }
}
