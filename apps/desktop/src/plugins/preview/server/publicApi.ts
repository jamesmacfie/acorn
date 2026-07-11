import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import type { AppDatabase } from '../../../core/server/db'
import { loadTask, taskRoot, workspaceConfigRow } from '../../../core/main/taskWorktree'
import { PublicApiError } from '../../../core/shared/publicApi/errors'
import { IdSchema } from '../../../core/shared/publicApi/primitives'
import {
  NavigationSchema,
  NavigationStateSchema,
  PreviewConfigurationSchema,
  ResolveUrlResultSchema,
  SetUrlSchema,
} from '../../../core/shared/publicApi/preview'
import { NO_CONTENT, defineEndpoint, type PluginApiContribution } from '../../../core/server/publicApi/defineEndpoint'
import { previewCurrentUrl, previewEvictTask, previewLoadUrl, previewNavState, previewNavigate } from '../main/previewService'

// Preview plugin public API (docs/next/api/plugin-api.md §12). Base /plugins/preview/tasks/:taskId.
// Electron-only (WebContentsView): configuration + resolve-url are computed server-side from the
// workspace preview settings; url/navigation/evict act on the task's live preview view (409 when no
// view exists — presentation is renderer-owned).

const PLUGIN = 'preview'
const exec = promisify(execFile)
const TaskParams = z.strictObject({ taskId: IdSchema })

async function previewSettings(db: AppDatabase, taskId: string): Promise<{ mode: 'url' | 'port' | 'script' | null; value: string | null }> {
  const t = await loadTask(db, taskId)
  if (!t) throw new PublicApiError('not_found', 'Task not found')
  const ws = await workspaceConfigRow(db, t.repoOwner, t.repoName)
  return { mode: (ws?.previewMode as 'url' | 'port' | 'script' | null) ?? null, value: ws?.previewValue ?? null }
}

async function resolveUrl(db: AppDatabase, taskId: string): Promise<string> {
  const { mode, value } = await previewSettings(db, taskId)
  if (mode === 'url') {
    if (!value) throw new PublicApiError('conflict', 'No preview URL configured')
    return value
  }
  if (mode === 'port') {
    if (!value) throw new PublicApiError('conflict', 'No preview port configured')
    return `http://localhost:${value}`
  }
  if (mode === 'script') {
    if (!value) throw new PublicApiError('conflict', 'No preview script configured')
    const cwd = await taskRoot(db, taskId)
    if (!cwd) throw new PublicApiError('conflict', 'No worktree yet — open a terminal first')
    try {
      const { stdout } = await exec('/bin/sh', ['-c', value], { cwd, timeout: 10_000 })
      const url = stdout.split('\n').map((l) => l.trim()).filter(Boolean).pop()
      if (!url) throw new PublicApiError('conflict', 'Preview script produced no output')
      return url
    } catch (e) {
      if (e instanceof PublicApiError) throw e
      throw new PublicApiError('conflict', e instanceof Error ? e.message : 'preview script failed')
    }
  }
  throw new PublicApiError('conflict', 'Preview is not configured for this task')
}

export function buildPreviewPublicApi(db: AppDatabase): PluginApiContribution {
  return {
    pluginId: PLUGIN,
    endpoints: [
      defineEndpoint({
        operationId: 'preview.configuration',
        pluginId: PLUGIN,
        method: 'GET',
        path: '/tasks/:taskId/configuration',
        scope: 'read',
        risk: 'read',
        summary: 'Resolved preview mode/value + current URL',
        params: TaskParams,
        response: PreviewConfigurationSchema,
        handler: async (_ctx, { params }) => {
          const { mode, value } = await previewSettings(db, params.taskId)
          return { mode, value, url: previewCurrentUrl(params.taskId) }
        },
      }),
      defineEndpoint({
        operationId: 'preview.resolve-url',
        pluginId: PLUGIN,
        method: 'POST',
        path: '/tasks/:taskId/resolve-url',
        scope: 'write',
        risk: 'execute', // script-backed preview runs a shell command
        summary: 'Resolve the preview URL',
        params: TaskParams,
        body: z.undefined(),
        response: ResolveUrlResultSchema,
        handler: async (_ctx, { params }) => ({ url: await resolveUrl(db, params.taskId) }),
      }),
      defineEndpoint({
        operationId: 'preview.url.set',
        pluginId: PLUGIN,
        method: 'PUT',
        path: '/tasks/:taskId/url',
        scope: 'write',
        risk: 'write',
        summary: 'Navigate the preview view to a URL',
        params: TaskParams,
        body: SetUrlSchema,
        response: z.strictObject({ url: z.string() }),
        handler: async (_ctx, { params, body }) => {
          if (!previewLoadUrl(params.taskId, body.url)) throw new PublicApiError('ui_unavailable', 'No preview view for this task')
          return { url: body.url }
        },
      }),
      defineEndpoint({
        operationId: 'preview.navigation',
        pluginId: PLUGIN,
        method: 'POST',
        path: '/tasks/:taskId/navigation',
        scope: 'write',
        risk: 'write',
        summary: 'Back/forward/reload/stop the preview view',
        params: TaskParams,
        body: NavigationSchema,
        response: NavigationStateSchema,
        handler: async (_ctx, { params, body }) => {
          if (!previewNavigate(params.taskId, body.action)) throw new PublicApiError('ui_unavailable', 'No preview view for this task')
          const state = previewNavState(params.taskId)
          if (!state) throw new PublicApiError('ui_unavailable', 'No preview view for this task')
          return state
        },
      }),
      defineEndpoint({
        operationId: 'preview.view.delete',
        pluginId: PLUGIN,
        method: 'DELETE',
        path: '/tasks/:taskId/view',
        scope: 'write',
        risk: 'write',
        summary: 'Evict the task preview view',
        params: TaskParams,
        response: z.undefined(),
        status: 204,
        handler: async (_ctx, { params }) => {
          previewEvictTask(params.taskId)
          return NO_CONTENT
        },
      }),
    ],
  }
}
