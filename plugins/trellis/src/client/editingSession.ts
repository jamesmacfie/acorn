import type { QueryClient } from '@tanstack/solid-query'
import { writeJson } from '@acorn/plugin-api/client'
import type { AgentContextSnapshot } from '@acorn/protocol/agentContext.ts'
import type { AgentConversationSurface } from '@acorn/plugin-agents/contract/conversation.ts'
import { appSessionRoute, type AppListing, type AppRevisionFiles } from '../shared/api'
import { refreshApps } from './appsStore'
import { revisionFilesOptions } from './AppToolCard'

/** Starts an interactive session in a task with the app attached to its first draft, and names it the
 *  app's building session. The drawer's Start an editing session and Edit in a new task both use it. */
export async function startEditingSession(
  surface: AgentConversationSurface,
  queryClient: QueryClient,
  nodeId: string,
  taskId: string,
  app: AppListing,
): Promise<string> {
  const files = await queryClient.fetchQuery(revisionFilesOptions(nodeId, app.appId, app.head))
  const sessionId = await surface.startSession({
    taskId,
    title: `Edit ${app.name}`,
    context: appContext(app, files),
    ...(app.sessionId ? { like: app.sessionId } : {}),
  })
  await writeJson(appSessionRoute(app.appId), {
    method: 'PUT',
    nodeId,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  })
  // The listing names the session the drawer draws, so read it again. The new session is open.
  queryClient.setQueryData(['trellis-session-open', nodeId, sessionId], true)
  await refreshApps()
  return sessionId
}

/** What an editing session starts with: the app's name, description, head, and files. */
function appContext(app: AppListing, files: AppRevisionFiles): AgentContextSnapshot {
  const content = [
    `The app "${app.name}" (${app.appId}) at v${app.head}. ${app.description}`.trim(),
    'Change it with the app tools: app_read for the working files and their hashes, then app_patch or app_write, then app_show. Read app_guide first if you have not.',
    ...(app.draftOf ? ["It's a draft of a project app. The person publishes it to the project when it's ready."] : []),
    `program:\n${files.program}`,
    ...Object.entries(files.plans).map(([name, plan]) => `plans/${name}:\n${JSON.stringify(plan, null, 2)}`),
  ].join('\n\n')
  return {
    type: 'context',
    contextId: `trellis:${app.appId}:${app.head}`,
    label: `${app.name} · v${app.head}`,
    content,
    source: 'trellis.app',
    capturedAt: Date.now(),
  }
}
