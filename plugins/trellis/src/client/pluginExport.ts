import type { QueryClient } from '@tanstack/solid-query'
import {
  createProject,
  createTask,
  projectsKey,
  readJson,
  tasksOptions,
  workspacesKey,
  writeJson,
  type Task,
} from '@acorn/plugin-api/client'
import { corePluginsRoute, type NodePluginRow, type NodePluginState } from '@acorn/protocol/api.ts'
import type { AgentContextSnapshot } from '@acorn/protocol/agentContext.ts'
import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { AgentConversationSurface } from '@acorn/plugin-agents/contract/conversation.ts'
import {
  appPluginRoute,
  appRoute,
  PLUGIN_SEED_STATE_FILE,
  type AppListing,
  type AppRevisionFiles,
  type AppSummary,
  type PluginPackageRequest,
} from '../shared/api'
import { revisionFilesOptions } from './AppToolCard'

// Turn into a plugin (docs/agent-built-apps/project-apps.md § Turn into a plugin). The Node writes the
// scaffold's package into the folder. The folder becomes a project, so a project-folder task there runs
// its agent in the package, and the session starts with the app as its brief, attached to its first
// draft as an editing session's app is.

export type PluginTarget = Pick<PluginPackageRequest, 'pluginId' | 'name' | 'folder'>

/** The plugins behind the data sources an app's plans read, each with its running major as the range.
 *  A compiled plugin has no version, so it's named with no range. A source no plugin answers for, such
 *  as core's own tasks, needs nothing. */
export function pluginRequirements(
  plans: AppRevisionFiles['plans'],
  plugins: readonly NodePluginRow[],
): PluginPackageRequest['requires']['plugins'] {
  const ids = new Set<string>()
  for (const plan of Object.values(plans) as PanelPlan[])
    for (const { reference } of plan.sources)
      // shortcut: a saved query names its source only in the query library, so it adds nothing here.
      // Apps write inline queries, as the plan guide asks. Look saved ones up if apps start using them.
      if (reference.kind === 'inline') ids.add(reference.content.query.source.pluginId)
  return [...ids].sort().flatMap((id) => {
    const row = plugins.find((plugin) => plugin.name === id)
    if (!row) return []
    const major = /^(\d+)\./.exec(row.installed?.version ?? '')?.[1]
    return [{ id, ...(major ? { version: major } : {}) }]
  })
}

/** Writes the package, makes its folder a project in the app's workspace, and starts a session in a
 *  new task there with the brief attached. Answers the task and the session. */
export async function turnIntoPlugin(
  surface: AgentConversationSurface,
  queryClient: QueryClient,
  nodeId: string,
  app: AppListing,
  workspaceId: string,
  target: PluginTarget,
): Promise<{ task: Task; sessionId: string }> {
  const [files, summary, plugins] = await Promise.all([
    queryClient.fetchQuery(revisionFilesOptions(nodeId, app.appId, app.head)),
    readJson<AppSummary>(appRoute(app.appId), { nodeId }),
    readJson<NodePluginState>(corePluginsRoute, { nodeId }),
  ])
  const request: PluginPackageRequest = {
    ...target,
    requires: { plugins: pluginRequirements(files.plans, plugins.plugins) },
  }
  await writeJson(appPluginRoute(app.appId), {
    method: 'POST',
    nodeId,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  })
  const project = await createProject({ path: target.folder, workspaceId }).catch((error: { code?: string }) => {
    // With workspaces off, every project is its own workspace.
    if (error.code === 'workspaces_off') return createProject({ path: target.folder })
    throw error
  })
  const task = await createTask(
    { origin: 'manual', projectId: project.project.id, title: `${target.name} plugin` },
    nodeId,
  )
  await Promise.all(
    [projectsKey, workspacesKey, tasksOptions(true).queryKey].map((queryKey) =>
      queryClient.invalidateQueries({ queryKey }),
    ),
  )
  const sessionId = await surface.startSession({
    taskId: task.id,
    title: `Turn ${app.name} into a plugin`,
    context: pluginBrief(app, files, summary, request),
    ...(app.sessionId ? { like: app.sessionId } : {}),
  })
  return { task, sessionId }
}

/** The app's head program and plans, its revision notes, and what to do with them. */
function pluginBrief(
  app: AppListing,
  files: AppRevisionFiles,
  summary: AppSummary,
  request: PluginPackageRequest,
): AgentContextSnapshot {
  const requires = request.requires.plugins.map((plugin) =>
    plugin.version ? `${plugin.id} (major ${plugin.version})` : plugin.id,
  )
  const content = [
    `Rebuild the app "${app.name}" as an Acorn plugin. ${app.description}`.trim(),
    `This folder is the plugin's package, ${request.folder}. Acorn wrote it from the plugin scaffold. acorn-plugin.json declares one tree pane, "${request.pluginId}", and its requires.plugins names the plugins behind the app's data sources: ${requires.join(', ') || 'none'}. Keep those requirements.`,
    'Call the plugin_authoring tool first. Rebuild the app as that tree pane, over the same data sources the plans below read. Where the program draws a plan with Panel, the plugin can reserve a dashboard region for it, and the person can publish the plan as a panel there.',
    `${PLUGIN_SEED_STATE_FILE} holds the app's saved $ variables. Never read it automatically. The person decides whether to load it or delete it.`,
    `When the pane works, ask for the package with plugin_request { action: "install", source: { path: "${request.folder}" }, dev: true }.`,
    `The app's program, at v${app.head}:\n${files.program}`,
    ...Object.entries(files.plans).map(([name, plan]) => `plans/${name}:\n${JSON.stringify(plan, null, 2)}`),
    `Revision notes:\n${summary.revisions.map((revision) => `v${revision.revision}: ${revision.note}`).join('\n')}`,
  ].join('\n\n')
  return {
    type: 'context',
    contextId: `trellis:${app.appId}:${app.head}:plugin`,
    label: `${app.name} · plugin brief`,
    content,
    source: 'trellis.app',
    capturedAt: Date.now(),
  }
}
