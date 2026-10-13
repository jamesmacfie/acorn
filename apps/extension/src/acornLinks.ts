import { buildLink, type Place } from '@acorn/client-core/host/registries/commands/addresses'

// `acorn://` links into the desktop app (docs/frontend/acorn-links.md), for the sidebar and for the task
// chip on a web page. The Node ID is the bridge's, which is the Node's own ID, the same one the
// desktop's links name.

// The desktop pane that shows a handed-off item, by the plugin whose handoff matched the page. A task
// from a plugin missing here opens on whichever pane it showed last.
const ITEM_PANES: Record<string, string> = { github: 'pr' }
// The agents plugin's pane, which selects the conversation a link names as its item.
const AGENT_PANE = 'agents'

// The link, or null when the address can't be one, such as an item address over the length limit.
function link(nodeId: string, place: Parameters<typeof buildLink>[1]): string | null {
  try {
    return buildLink(nodeId, place)
  } catch {
    return null
  }
}

const task = (taskId: string, pane: string | undefined, item?: string): Extract<Place, { kind: 'task' }> => ({
  kind: 'task',
  taskId,
  ...(pane ? { pane } : {}),
  ...(item ? { item } : {}),
})

export const itemTaskLink = (nodeId: string, pluginId: string, taskId: string) =>
  link(nodeId, task(taskId, ITEM_PANES[pluginId]))
export const conversationLink = (nodeId: string, taskId: string, sessionId: string) =>
  link(nodeId, task(taskId, AGENT_PANE, sessionId))
// The project's place in the desktop app, where a task is made with the desktop's own choices.
export const projectLink = (nodeId: string, projectId: string) => link(nodeId, { kind: 'project', projectId, rest: [] })
// An outside item with no task: the desktop finds what claims the address.
export const outsideItemLink = (nodeId: string, url: string) => link(nodeId, { kind: 'open', url })
