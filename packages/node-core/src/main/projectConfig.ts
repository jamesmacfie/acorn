import { z } from 'zod'
import { normalizeBranchPrefix } from '@acorn/protocol/branch.ts'
import { isValidBrowserRule, parseBrowserRules } from '@acorn/protocol/browserRules.ts'
import type {
  BrowserRule,
  DbSchemaMode,
  PreviewMode,
  ProjectConfigPatch,
  ProjectConfigResponse,
  SetupTrigger,
} from '@acorn/protocol/api.ts'
import type { AppDatabase } from '../server/db'
import { eq } from 'drizzle-orm'
import { schema } from '../server/db'
import { getProject } from './projects'

const runTargetWireSchema = z.object({
  id: z.string().min(1),
  command: z.string().min(1),
  stop: z.string().optional(),
  restart: z.string().optional(),
  url: z.string().optional(),
  urlCommand: z.string().optional(),
  icon: z.string().optional(),
  default: z.boolean().optional(),
}).refine((target) => !(target.url && target.urlCommand), { message: 'url and urlCommand are mutually exclusive' })

export function projectConfigFromRow(row: typeof schema.projects.$inferSelect): ProjectConfigResponse {
  return {
    projectId: row.id,
    config: {
      runTargets: row.runTargets,
      editorCommand: row.editorCommand,
      setupScript: row.setupScript,
      setupScriptTrigger: (row.setupScriptTrigger as SetupTrigger | null) ?? null,
      devScript: row.devScript,
      devRestartScript: row.devRestartScript,
      teardownScript: row.teardownScript,
      dbUrlScript: row.dbUrlScript,
      dbSchemaMode: (row.dbSchemaMode as DbSchemaMode | null) ?? null,
      dbSchemaValue: row.dbSchemaValue,
      dbSchemaNotes: row.dbSchemaNotes,
      previewMode: (row.previewMode as PreviewMode | null) ?? null,
      previewValue: row.previewValue,
      browserRules: parseBrowserRules(row.browserRules),
      branchPrefix: row.branchPrefix,
    },
  }
}

export async function getProjectConfig(db: AppDatabase, projectId: string): Promise<ProjectConfigResponse | null> {
  const project = await getProject(db, projectId)
  return project ? projectConfigFromRow(project) : null
}

export type ProjectConfigResult =
  | { ok: true; response: ProjectConfigResponse }
  | { ok: false; reason: string }

export async function setProjectConfig(
  db: AppDatabase,
  projectId: string,
  patch: ProjectConfigPatch,
): Promise<ProjectConfigResult> {
  const project = await getProject(db, projectId)
  if (!project) return { ok: false, reason: 'No such project.' }

  const set: Record<string, string | null> = {}
  const scalar = (value: string) => value.trim() || null
  if (patch.setupScript !== undefined) set.setupScript = scalar(patch.setupScript)
  if (patch.teardownScript !== undefined) set.teardownScript = scalar(patch.teardownScript)
  if (patch.devScript !== undefined) set.devScript = scalar(patch.devScript)
  if (patch.devRestartScript !== undefined) set.devRestartScript = scalar(patch.devRestartScript)
  if (patch.dbUrlScript !== undefined) set.dbUrlScript = scalar(patch.dbUrlScript)
  if (patch.dbSchemaValue !== undefined) set.dbSchemaValue = scalar(patch.dbSchemaValue)
  if (patch.dbSchemaNotes !== undefined) set.dbSchemaNotes = scalar(patch.dbSchemaNotes)
  if (patch.dbSchemaMode !== undefined) {
    if (patch.dbSchemaMode && !['auto', 'script', 'file'].includes(patch.dbSchemaMode)) return { ok: false, reason: 'Invalid schema mode.' }
    set.dbSchemaMode = patch.dbSchemaMode || null
  }
  if (patch.setupScriptTrigger !== undefined) set.setupScriptTrigger = patch.setupScriptTrigger
  if (patch.previewMode !== undefined) {
    if (patch.previewMode && !['url', 'port', 'script'].includes(patch.previewMode)) return { ok: false, reason: 'Invalid preview mode.' }
    set.previewMode = patch.previewMode || null
  }
  if (patch.previewValue !== undefined) set.previewValue = scalar(patch.previewValue)

  const effectiveMode = patch.previewMode !== undefined ? patch.previewMode : project.previewMode
  const effectiveValue = patch.previewValue !== undefined ? scalar(patch.previewValue) : project.previewValue
  if (effectiveMode === 'port' && effectiveValue != null) {
    const port = Number(effectiveValue)
    if (!/^\d{1,5}$/.test(effectiveValue) || port < 1 || port > 65535) return { ok: false, reason: 'Preview port must be 1-65535.' }
  }

  if (patch.branchPrefix !== undefined) set.branchPrefix = normalizeBranchPrefix(patch.branchPrefix) || null
  if (patch.browserRules !== undefined) {
    const rules: BrowserRule[] = patch.browserRules.filter(isValidBrowserRule)
    set.browserRules = rules.length ? JSON.stringify(rules) : null
  }

  if (Object.keys(set).length) {
    await db.update(schema.projects).set({ ...set, updatedAt: Date.now() }).where(eq(schema.projects.id, projectId))
  }
  const updated = await getProject(db, projectId)
  return updated ? { ok: true, response: projectConfigFromRow(updated) } : { ok: false, reason: 'No such project.' }
}

export async function setProjectRunTargets(db: AppDatabase, projectId: string, json: string): Promise<ProjectConfigResult> {
  const project = await getProject(db, projectId)
  if (!project) return { ok: false, reason: 'No such project.' }
  const value = json.trim() || null
  if (value) {
    try {
      const parsed = z.array(runTargetWireSchema).safeParse(JSON.parse(value))
      if (!parsed.success) return { ok: false, reason: 'Run targets must be a valid JSON array of targets.' }
    } catch {
      return { ok: false, reason: 'Invalid JSON.' }
    }
  }
  await db.update(schema.projects).set({ runTargets: value, updatedAt: Date.now() }).where(eq(schema.projects.id, projectId))
  const updated = await getProject(db, projectId)
  return updated ? { ok: true, response: projectConfigFromRow(updated) } : { ok: false, reason: 'No such project.' }
}
