import type {
  PluginCollectionEnumValue,
  PluginCollectionPage,
  PluginCollectionRow,
  PluginCollectionSchema,
} from '@acorn/protocol/collections.ts'
import { MAX_COLLECTION_ENUM_VALUES } from '@acorn/protocol/collections.ts'
import { projectsRoute, tasksRoute, workspacesRoute, type Project, type ProjectsResponse, type Task, type Workspace } from '@acorn/protocol/api.ts'
import { readJson } from '../../infra/node/apiClient'
import { activeNodeId } from '../../infra/node/activeNode'
import type { CollectionRegistration } from '../../host/registries/sources/collections'
import { taskStatus } from './taskStatus'

// The tasks of a workspace as a dashboard collection (docs/dashboards.md § Collections).
//
// Core's own, registered from the shell's activation rather than by a plugin, for the same reason the
// plugin-failure attention source is: there is no plugin whose data this is. It reads the three core
// routes the rail already reads and adds no endpoint.
//
// It is also how the task list Home used to draw above its panels is rebuilt by anyone who wants it.
// That list was on the screen whether or not it was being read, and a panel is the same rows placed on
// purpose, sorted, filtered and sized by the person reading them.

export const TASKS_COLLECTION_ID = 'tasks'

// `project` and `workspace` are enums with no declared values here: their values are this node's own
// rows, which no static declaration can name. Declaring the type anyway is what lets the editor offer a
// board grouped by either before a node has answered; `fetch` fills the labels in the response.
const tasksSchema = {
  fields: [
    { id: 'title', name: 'Task', type: 'text', role: 'title' },
    { id: 'project', name: 'Project', type: 'enum' },
    { id: 'workspace', name: 'Workspace', type: 'enum' },
    { id: 'origin', name: 'Origin', type: 'text' },
    { id: 'branch', name: 'Branch', type: 'text' },
    { id: 'changes', name: 'Changes', type: 'boolean' },
  ],
} satisfies PluginCollectionSchema

/** The rows' own projects and workspaces, as declared enum values, so a cell reads `acorn` rather than a
 *  uuid and a board's columns come out in name order.
 *
 *  Sliced to the wire cap. Past 32 of either, the surplus renders as its raw id, which is the same thing
 *  every undeclared enum value does (dashboards-core/format.ts). */
const enumValues = (entries: Iterable<[string, string]>): PluginCollectionEnumValue[] =>
  [...new Map(entries)]
    .map(([id, label]) => ({ id, label }))
    .sort((left, right) => left.label.localeCompare(right.label))
    .slice(0, MAX_COLLECTION_ENUM_VALUES)

const workspaceOf = (workspaces: Workspace[], projectId: string): Workspace | undefined =>
  workspaces.find((workspace) => workspace.projects.some((project) => project.id === projectId))

const taskRow = (
  task: Task,
  project: Project | undefined,
  workspace: Workspace | undefined,
  dirty: boolean | null,
): PluginCollectionRow => ({
  id: task.id,
  pluginId: 'core',
  collectionId: TASKS_COLLECTION_ID,
  // The carrier for the row's action: a panel is drawn outside every task, so the click has to say which
  // task it means (@acorn/protocol/collections.ts).
  taskId: task.id,
  action: { verb: 'openTask' },
  values: {
    title: task.title,
    project: project?.id ?? null,
    workspace: workspace?.id ?? null,
    origin: task.origin,
    branch: task.branch,
    changes: dirty,
  },
})

export const tasksCollection: CollectionRegistration = {
  collectionId: TASKS_COLLECTION_ID,
  name: 'Workspace tasks',
  schema: tasksSchema,
  // Unset is every workspace on the node, which is what the old Home list showed. Set, it is one, and the
  // value is part of the panel definition, so the answer is cached per workspace instead of changing
  // under a key that cannot see it.
  params: [{ id: 'workspace', name: 'Workspace', type: 'enum' }],
  paramOptions: async (paramId, nodeId) => {
    if (paramId !== 'workspace') return []
    const workspaces = await readJson<Workspace[]>(workspacesRoute, { nodeId })
    return workspaces
      .map((workspace) => ({ id: workspace.id, label: workspace.name }))
      .sort((left, right) => left.label.localeCompare(right.label))
  },
  // The task list itself moves on task creation and archive, both of which are this client's own writes;
  // half a minute is for the worktree's dirty flag, which moves on its own.
  refresh: 30,
  fetch: async (nodeId, params, signal): Promise<PluginCollectionPage> => {
    const [tasks, projects, workspaces] = await Promise.all([
      readJson<Task[]>(tasksRoute, { nodeId, signal }),
      readJson<ProjectsResponse>(projectsRoute, { nodeId, signal }).then((body) => body.projects),
      readJson<Workspace[]>(workspacesRoute, { nodeId, signal }),
    ])
    // The dirty flag is the status poller's, which polls the active node and only on desktop. A panel
    // pointed anywhere else gets a null cell, which reads as "no value here" rather than "clean".
    const local = nodeId === activeNodeId()
    return tasksPage({
      tasks,
      projects,
      workspaces,
      ...(params.workspace ? { workspaceId: params.workspace } : {}),
      dirty: (taskId) => (local ? taskStatus(taskId)?.dirty ?? null : null),
    })
  },
}

/** The whole answer, minus the reading. Pure, so the filtering and the labelling are testable in a suite
 *  that has no node to ask. */
export function tasksPage(input: {
  tasks: Task[]
  projects: Project[]
  workspaces: Workspace[]
  workspaceId?: string
  dirty: (taskId: string) => boolean | null
}): PluginCollectionPage {
  const rows = input.tasks.flatMap((task) => {
    const project = input.projects.find((candidate) => candidate.id === task.projectId)
    // A hidden project is one Settings is still repairing, and the rail leaves its tasks out too.
    if (project?.hidden) return []
    const workspace = workspaceOf(input.workspaces, task.projectId)
    if (input.workspaceId && workspace?.id !== input.workspaceId) return []
    return [taskRow(task, project, workspace, input.dirty(task.id))]
  })
  return {
    schema: {
      fields: tasksSchema.fields.map((field) => {
        if (field.id === 'project') return { ...field, values: enumValues(input.projects.map((entry) => [entry.id, entry.name])) }
        if (field.id === 'workspace') return { ...field, values: enumValues(input.workspaces.map((entry) => [entry.id, entry.name])) }
        return field
      }),
    },
    rows,
  }
}
