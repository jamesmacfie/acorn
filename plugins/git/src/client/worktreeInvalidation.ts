import { onCleanup } from 'solid-js'
import { clientEvents, wsOnNodeEvent, wsOnReconnect } from '@acorn/plugin-api/client'

/** The selected Node's broadcasts and local task writes both change the roster's ownership view. */
export function watchWorktreeInventory(refresh: () => void): void {
  const unsubscribe = [
    wsOnNodeEvent('worktree:status-changed', refresh),
    clientEvents.on('tasks:changed', refresh),
    wsOnReconnect(refresh),
  ]
  onCleanup(() => unsubscribe.forEach((off) => off()))
}
