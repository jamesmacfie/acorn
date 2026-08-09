import type { PluginChromeAction, PluginRailItem } from '@acorn/protocol/api.ts'
import { sendRaw } from '../../apiClient'
import { pushNotice } from '../../notifications/notifications'
import { openPane } from '../../registries/clientEvents'
import { activeTaskId } from '../../tasks/tasks'
import { ownsRoute } from './data'

// The closed verb set the host executes on a descriptor's behalf
// (docs/plugins.md).
//
// Closed is the point. Every plugin composes the same few verbs, each one is a thing the host does in
// its OWN realm, and adding a verb later is additive. What is NOT here in v1 is `invoke` — an RPC into
// the plugin's frame, mounting it if none is up. It needs a headless frame lifecycle the shell does not
// have, and the phase doc says not to block on it; a manifest naming it fails to parse, so an author is
// told rather than shipping a row that silently does nothing.

export type ChromeActionContext = {
  pluginId: string
  nodeId: string
  // The row that was clicked, for the surfaces that have rows. It is the whole reason `openPane` is
  // not the same thing twenty times over on a twenty-row rail list.
  item?: PluginRailItem
  promote?: (item: PluginRailItem) => void
}

const toast = (pluginId: string, title: string, detail?: string): void =>
  void pushNotice({ taskId: activeTaskId() ?? '', kind: 'plugin', title: `${pluginId}: ${title}`, at: Date.now(), ...(detail ? { detail } : {}) })

export function runChromeAction(action: PluginChromeAction, context: ChromeActionContext): void {
  switch (action.verb) {
    case 'openPane': {
      // A pane lives in a task's layout, so there is nothing to open into outside a task. Saying so is
      // better than a click that appears to do nothing — the rail is reachable with no task open.
      const taskId = activeTaskId()
      if (!taskId) return toast(context.pluginId, 'open a task first', 'This opens a pane, and a pane belongs to a task.')
      // The row id travels as a retained pane intent, which is the mechanism that already closed this
      // exact mount-order race for core panes (registries/clientEvents.ts): the intent is held until the
      // pane consumes it, so a pane opening for the first time is not a race against its own mount.
      openPane(taskId, action.pane, context.item === undefined ? undefined : { kind: 'plugin:select', item: context.item.id })
      return
    }
    case 'runNodeAction': {
      // Repeated on this side for the same reason every read is: the path came off a roster row.
      if (!ownsRoute(context.pluginId, action.path)) return toast(context.pluginId, 'refused an action outside its own namespace')
      void sendRaw(action.path, {
        method: 'POST',
        nodeId: context.nodeId,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(context.item === undefined ? {} : { item: context.item.id }),
      }).then((result) => {
        // Success is silent — the node's status ping is what tells the chrome to re-read. Only a failure
        // needs saying, because nothing else on screen would show it.
        if (!result.ok) toast(context.pluginId, 'action failed', result.error?.message ?? `${result.status}`)
      }, (error: unknown) => toast(context.pluginId, 'action failed', error instanceof Error ? error.message : String(error)))
      return
    }
    case 'createTask':
      if (!context.item || !context.promote) {
        return toast(context.pluginId, 'could not create a task', 'This action needs a selected source row.')
      }
      context.promote(context.item)
      return
    case 'openUrl':
      // Manifest parsing already rejected anything but https. `window.open` is denied by main's
      // setWindowOpenHandler, which hands the URL to `openExternal` — so this opens in the owner's
      // browser and never in-app (apps/desktop/src/app/main/electron.ts).
      window.open(action.url, '_blank', 'noopener,noreferrer')
  }
}
