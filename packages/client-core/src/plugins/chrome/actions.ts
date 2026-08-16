import type { PluginChromeAction, PluginRailItem } from '@acorn/protocol/api.ts'
import { isPluginOpenableUrl } from '@acorn/protocol/externalUrl.ts'
import { sendRaw } from '../../apiClient'
import { pushNotice } from '../../notifications/notifications'
import { clientEvents, openPane } from '../../registries/clientEvents'
import { openInAppUrl } from '../../registries/contentLinks'
import { projectSurfacePath } from '../../registries/projectSurfaces'
import { activeTaskId } from '../../tasks/tasks'
import { openPluginOverlay } from '../frames/overlays'
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
  // The routed project and the shell's navigator, for `navigate`. Supplied only by the callers that have
  // them — which is why the manifest refuses to let a COMMAND name that verb at all: a command registry row
  // runs with neither in scope, the same argument that already keeps `createTask` off the command list.
  projectId?: string
  navigate?: (path: string) => void
  // The id of the command being run, for `surfaceAction` — which delivers that id to the plugin's own
  // frame. Supplied only by the command caller, which is the only click site that has one.
  commandId?: string
  // Where an `openUrl` should land, when this click site has an opinion. Only a dashboard row does today:
  // it is a jumping-off point rather than a place you are working, so it wants the full surface and not a
  // panel over the top of a list you were about to leave anyway.
  prefer?: 'route' | 'pane' | 'refPanel'
}

const toast = (pluginId: string, title: string, detail?: string): void =>
  void pushNotice({ taskId: activeTaskId() ?? '', kind: 'plugin', title: `${pluginId}: ${title}`, at: Date.now(), ...(detail ? { detail } : {}) })

export function runChromeAction(action: PluginChromeAction, context: ChromeActionContext): void {
  switch (action.verb) {
    case 'openPane': {
      // A TASK-scoped pane lives in a task's layout, so there is nothing to open into outside a task.
      // Saying so is better than a click that appears to do nothing — the rail is reachable with no task
      // open. This refusal used to fire for every rail row of a plugin whose detail belonged to the
      // project rather than to a task, which was the carrier gap and not the message being wrong: the
      // manifest now only lets this verb name a task-scoped pane, and a project-scoped one has `navigate`.
      const taskId = activeTaskId()
      if (!taskId) return toast(context.pluginId, 'open a task first', 'This opens a pane, and a pane belongs to a task.')
      // The row id travels as a retained pane intent, which is the mechanism that already closed this
      // exact mount-order race for core panes (registries/clientEvents.ts): the intent is held until the
      // pane consumes it, so a pane opening for the first time is not a race against its own mount.
      openPane(taskId, action.pane, context.item === undefined ? undefined : { kind: 'plugin:select', item: context.item.id })
      return
    }
    case 'navigate': {
      // A project-scoped surface is ADDRESSED, not opened. Its selection lives in the URL — it has no task
      // layout to keep one in — so changing the URL is the selection, and the surface is already on screen
      // beside the list that was clicked. No task is involved anywhere, which is the point: this is the
      // verb a rail row uses when its detail belongs to the project.
      //
      // The path is minted from the pattern the host registered, never from anything on the row.
      const item = context.item?.id
      const path = context.projectId && item ? projectSurfacePath(action.surface, context.projectId, item) : null
      if (!path || !context.navigate) {
        return toast(context.pluginId, 'pick a project first', 'This opens beside a project’s list, so it needs one selected.')
      }
      context.navigate(path)
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
    case 'openOverlay':
      // No task check, unlike `openPane`: an overlay is a rectangle over the whole window, not a row in a
      // task's layout, which is why it is the one verb that works from anywhere. Whether the SURFACE is
      // one this plugin declared was checked when the manifest was read and again on the device before
      // registration, so nothing but a declared overlay can be named here.
      openPluginOverlay(context.pluginId, action.overlay)
      return
    case 'surfaceAction':
      // The one verb whose effect lands INSIDE a plugin. No task check and no mount check: the event is
      // fire-and-forget, and a pane nobody has open simply has no frame listening — which is the honest
      // outcome, because the command means "do this in the thing I am looking at". Deliberately not
      // retained the way a pane intent is (registries/clientEvents.ts says why).
      //
      // The surface named here was checked against this manifest's own composed panes when the node
      // parsed it; the frame that receives it re-checks that the event is addressed to ITS plugin and ITS
      // surface, because that is the side holding the port.
      //
      // What the frame receives is the COMMAND's own id, so there is one id rather than two that can
      // drift. That is also why this verb is only useful on a command: a footer badge's click has no
      // command in scope, and rather than invent a second name for the thing being delivered, the
      // verb refuses there.
      if (!context.commandId) return toast(context.pluginId, 'surfaceAction needs a command', 'This verb delivers a command id, so it only works from a command.')
      clientEvents.emit('plugin:surface-action', { pluginId: context.pluginId, surface: action.surface, command: context.commandId })
      return
    case 'openUrl':
      // Repeated on this side for the same reason `runNodeAction` re-checks its path: the URL came off
      // a roster row, and a roster row is wire input from a node. `window.open` is denied by main's
      // setWindowOpenHandler, which hands the URL to `openExternal` — so this opens in the owner's
      // browser and never in-app (apps/desktop/src/app/main/electron.ts).
      if (!isPluginOpenableUrl(action.url)) return toast(context.pluginId, 'refused a non-https URL')
      // A URL acorn has its OWN surface for stays inside acorn. A dashboard row for one of my pull
      // requests names github.com because that is the durable identity of the thing, not because the
      // browser is where the owner wanted to end up. Which destination it gets is entirely the owning
      // plugin's declaration (registries/contentLinks.ts § openInAppUrl); this only asks, and a URL
      // nobody claims falls through to the browser exactly as before.
      //
      // The CLICK SITE chooses, never this switch and never the plugin. A dashboard row is somewhere you
      // leave FROM, so it asks for the route; a badge or a command sits beside work in progress and asks
      // for the glance. `refPanel` is the default because that is every caller that has not thought about
      // it, and moving a reader who did not ask to be moved is the worse mistake.
      if (openInAppUrl(action.url, {
        taskId: activeTaskId(),
        prefer: context.prefer ?? 'refPanel',
        ...(context.navigate ? { navigate: context.navigate } : {}),
      })) return
      window.open(action.url, '_blank', 'noopener,noreferrer')
  }
}
