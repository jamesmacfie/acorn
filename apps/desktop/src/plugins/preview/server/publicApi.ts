import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import type { AppDatabase } from '../../../core/server/db'
import { homedir } from 'node:os'
import { loadTask, taskRoot } from '../../../core/main/taskWorktree'
import { getRepoPath } from '../../../core/main/repoPaths'
import { loadRepoConfig } from '../../../core/main/runConfig'
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
import type { PreviewDesktopCapability } from '../../../core/shared/desktopCapabilities'

// Preview plugin public API (docs/public-api.md). Base /plugins/preview/tasks/:taskId.
// Configuration + resolve-url are computed in the utility service from workspace preview settings.
// url/navigation/evict cross the typed native capability boundary to the task's live
// WebContentsView (409 when no view exists — presentation is renderer-owned).

const PLUGIN = 'preview'
const exec = promisify(execFile)
const TaskParams = z.strictObject({ taskId: IdSchema })

async function previewSettings(db: AppDatabase, taskId: string): Promise<{ mode: 'url' | 'port' | 'script' | null; value: string | null }> {
  const t = await loadTask(db, taskId)
  if (!t) throw new PublicApiError('not_found', 'Task not found')
  const root = await taskRoot(db, taskId)
  const rp = await getRepoPath(db, t.repoOwner, t.repoName)
  const cfg = loadRepoConfig(root ?? rp?.path ?? null, homedir(), { previewMode: rp?.previewMode, previewValue: rp?.previewValue })
  return cfg.preview
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

export function buildPreviewPublicApi(db: AppDatabase, desktop: PreviewDesktopCapability): PluginApiContribution {
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
          return { mode, value, url: await desktop.currentUrl(params.taskId) }
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
          if (!await desktop.loadUrl(params.taskId, body.url)) throw new PublicApiError('ui_unavailable', 'No preview view for this task')
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
          if (!await desktop.navigate(params.taskId, body.action)) throw new PublicApiError('ui_unavailable', 'No preview view for this task')
          const state = await desktop.navState(params.taskId)
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
          await desktop.evict(params.taskId)
          return NO_CONTENT
        },
      }),
    ],
  }
}
