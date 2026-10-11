import type { ClientPlugin } from '@acorn/client-core/host/registries/extensionPoints'

type PluginStartupOptions = {
  load: () => Promise<readonly ClientPlugin[]>
  register: (plugins: readonly ClientPlugin[], disabled: readonly string[]) => void
  refresh: (nodeId: string) => Promise<readonly string[] | null>
  activeNode: () => string | null
  disabled: () => readonly string[]
  onReady: () => void
  onFailed: (error: unknown) => void
}

/** Registration follows the first shell paint. Node applications wait for it and only commit to
 * the node still on screen; an unanswered roster remains retryable. */
export function createPluginStartup(options: PluginStartupOptions) {
  let start: Promise<readonly ClientPlugin[]> | undefined
  let failed = false
  let release: () => void = () => {}
  const started = new Promise<void>((resolve) => {
    release = resolve
  })
  let applied: string | null = null
  const pending = new Map<string, Promise<void>>()

  const initialize = (): Promise<readonly ClientPlugin[]> => {
    if (!start) {
      start = options
        .load()
        .then((plugins) => {
          options.register(plugins, options.disabled())
          options.onReady()
          return plugins
        })
        .catch((error: unknown) => {
          failed = true
          options.onFailed(error)
          throw error
        })
      release()
    }
    return start
  }

  // Only a settled failure is discarded, so a retry can never run beside the attempt it replaces.
  // A partial registration needs no cleanup here: the plugin host takes back each plugin's previous
  // contributions before that plugin registers again.
  const retry = (): Promise<readonly ClientPlugin[]> => {
    if (failed) {
      failed = false
      start = undefined
    }
    return initialize()
  }

  const apply = (nodeId: string): Promise<void> => {
    if (applied === nodeId && options.activeNode() === nodeId) return Promise.resolve()
    const existing = pending.get(nodeId)
    if (existing) return existing
    const pass = async (): Promise<void> => {
      await started
      // A failed roster is the startup screen's to show. Its retry applies the node again.
      const plugins = await start!.catch(() => null)
      if (!plugins || options.activeNode() !== nodeId) return
      const disabled = await options.refresh(nodeId)
      if (options.activeNode() !== nodeId) return
      options.register(plugins, disabled ?? options.disabled())
      applied = disabled !== null ? nodeId : null
    }
    const result = pass().finally(() => {
      pending.delete(nodeId)
    })
    pending.set(nodeId, result)
    return result
  }

  return { initialize, retry, apply }
}
