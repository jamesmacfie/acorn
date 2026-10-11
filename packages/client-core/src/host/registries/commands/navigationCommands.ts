import type { Task, Workspace } from '@acorn/protocol/api.ts'
import type { CommandSearchItem } from '@acorn/protocol/commands.ts'
import { activeNodeId, setActiveNode } from '../../../infra/node/activeNode'
import { nodes } from '../../../infra/node/fleet'
import { previousWorkspaceId } from '../../../features/workspaces/lastWorkspace'
import type { WorkspaceWords } from '../../../features/workspaces/words'
import type { Disposable } from '../../../kit/lib/state/registry'
import { COMMAND_CLOSED, registerCommands, type CommandOutcome } from './commands'
import { CORE_GO_TO_GROUP, goToGroup } from './coreCommands'
import { localSearch } from './localSearch'

// Go to task, switch workspace, last workspace, go to project and switch node: one group of commands
// that both clients register (docs/command-palette-and-shortcuts.md).
//
// What differs between the hosts is behind `NavigationHost`. The desktop lists the whole fleet and
// opens a place through its router (host/palette/routerNavigation.ts). The terminal lists the one node
// it draws and opens a place through its shell model (apps/tui/src/chrome/navigation.ts). Switching
// node is the same on both, so it is not a host operation.
//
// Every search loads when its frame opens and filters locally (./localSearch.ts). Not cached, because
// the rosters can arrive or change while the frame is open.

/** A task and the node it lives on. A task id is unique only within one node. */
export type NavigationTask = { task: Task; nodeId: string }
/** A workspace and the node it lives on. */
type NavigationWorkspace = { workspace: Workspace; nodeId: string }
type NavigationProject = { id: string; name: string; path?: string | null }

/** What the Go to commands need from the host that draws them: what to list, and how to open it. */
export type NavigationHost = {
  words: () => WorkspaceWords
  tasks: () => readonly NavigationTask[]
  /** The second line of a task's row. */
  taskSubtitle: (task: Task) => string | undefined
  workspaces: () => readonly NavigationWorkspace[]
  projects: () => readonly NavigationProject[]
  openTask: (row: NavigationTask) => void
  openWorkspace: (row: NavigationWorkspace) => void
  openProject: (projectId: string) => void
}

export const projectCount = (count: number): string => `${count} project${count === 1 ? '' : 's'}`

export function registerNavigationCommands(host: NavigationHost): Disposable {
  const { words } = host
  const onNode = (row: { nodeId: string }, nodeId: string | null): boolean => row.nodeId === (nodeId ?? '')

  return registerCommands([
    goToGroup(words),
    {
      id: 'core.goto.task',
      parentId: CORE_GO_TO_GROUP,
      kind: 'search',
      title: 'Go to task',
      category: 'navigation',
      palette: true,
      order: 100,
      placeholder: 'Find a task…',
      // A fleet search asks once per node and labels each row with the node that answered. On a host
      // with one node it asks that node alone (./sessionStore.ts § searchTargets).
      scope: 'fleet',
      ...localSearch(
        (context) =>
          host
            .tasks()
            .filter((row) => onNode(row, context.nodeId))
            // The task this session opened over is where the reader already is.
            .filter((row) => row.task.id !== context.taskId)
            .map((row): CommandSearchItem => {
              const subtitle = host.taskSubtitle(row.task)
              return { id: row.task.id, title: row.task.title, ...(subtitle ? { subtitle } : {}), taskId: row.task.id }
            }),
        { cache: false },
      ),
      select: (item, context): CommandOutcome => {
        const row = host.tasks().find((candidate) => candidate.task.id === item.id && onNode(candidate, context.nodeId))
        if (!row) throw new Error("That task isn't here any more.")
        host.openTask(row)
        return COMMAND_CLOSED
      },
    },
    {
      id: 'core.goto.workspace',
      parentId: CORE_GO_TO_GROUP,
      kind: 'search',
      title: () => `Switch ${words().singular}`,
      category: 'workspace',
      palette: true,
      order: 200,
      placeholder: () => `Find a ${words().singular}…`,
      scope: 'fleet',
      ...localSearch(
        (context) =>
          host
            .workspaces()
            .filter((entry) => onNode(entry, context.nodeId))
            // The captured workspace is the active node's, whichever node this search is asking.
            .filter((entry) => !(entry.workspace.id === context.workspaceId && onNode(entry, activeNodeId())))
            .map((entry): CommandSearchItem => ({
              id: entry.workspace.id,
              title: entry.workspace.name,
              ...(words().singular === 'workspace' ? { subtitle: projectCount(entry.workspace.projects.length) } : {}),
              workspaceId: entry.workspace.id,
            })),
        { cache: false },
      ),
      select: (item, context): CommandOutcome => {
        const entry = host
          .workspaces()
          .find((candidate) => candidate.workspace.id === item.id && onNode(candidate, context.nodeId))
        if (!entry) throw new Error(`That ${words().singular} isn't here any more.`)
        host.openWorkspace(entry)
        return COMMAND_CLOSED
      },
    },
    {
      id: 'core.goto.workspace-last',
      parentId: CORE_GO_TO_GROUP,
      title: () => `Last ${words().singular}`,
      hint: () => `back to the ${words().singular} you came from`,
      category: 'workspace',
      palette: true,
      order: 250,
      // The store holds a workspace id and the host is asked where it is now, so this means the same
      // thing whichever node is answering.
      scope: 'none',
      when: () => !!previousWorkspaceId(),
      run: (): CommandOutcome => {
        const entry = host.workspaces().find((candidate) => candidate.workspace.id === previousWorkspaceId())
        if (!entry) throw new Error(`That ${words().singular} isn't here any more.`)
        host.openWorkspace(entry)
        return COMMAND_CLOSED
      },
    },
    {
      id: 'core.goto.project',
      parentId: CORE_GO_TO_GROUP,
      kind: 'search',
      title: 'Go to project',
      hint: 'open a project without opening a task',
      category: 'navigation',
      palette: true,
      order: 300,
      placeholder: 'Find a project…',
      ...localSearch(
        () =>
          host.projects().map((project): CommandSearchItem => ({
            id: project.id,
            title: project.name,
            ...(project.path ? { subtitle: project.path } : {}),
            projectId: project.id,
          })),
        { cache: false },
      ),
      select: (item): CommandOutcome => {
        host.openProject(item.id)
        return COMMAND_CLOSED
      },
    },
    {
      id: 'core.goto.node',
      parentId: CORE_GO_TO_GROUP,
      kind: 'search',
      title: 'Switch node',
      category: 'navigation',
      palette: true,
      order: 400,
      placeholder: 'Find a node…',
      // The roster is this device's, not any one node's, so there is no identity to gate on.
      scope: 'none',
      when: () => nodes().length > 1,
      ...localSearch(
        () =>
          nodes()
            .filter((node) => node.nodeId !== activeNodeId())
            .map((node): CommandSearchItem => ({ id: node.nodeId, title: node.label })),
        { cache: false },
      ),
      select: (item): CommandOutcome => {
        setActiveNode(item.id)
        return COMMAND_CLOSED
      },
    },
  ])
}
