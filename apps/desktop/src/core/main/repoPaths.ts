import { execFile } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import { eq, and } from 'drizzle-orm'
import type { AppDatabase } from '../server/db'
import { schema } from '../server/db'
import { normalizeBranchPrefix } from '../shared/branch'
import { isValidBrowserRule, parseBrowserRules } from '../shared/browserRules'
import type { BrowserRule, DbSchemaMode, PreviewMode, SetupTrigger } from '../shared/api'
import type { RepoConfigPatch, RepoPath, RepoPathResult } from '../shared/terminal'

const exec = promisify(execFile)

export async function getRepoPath(db: AppDatabase, owner: string, repo: string): Promise<RepoPath | null> {
  const rows = await db
    .select()
    .from(schema.repoPaths)
    .where(and(eq(schema.repoPaths.owner, owner), eq(schema.repoPaths.repo, repo)))
  const row = rows[0]
  if (!row) return null
  return {
    owner: row.owner,
    repo: row.repo,
    path: row.path,
    runTargets: row.runTargets,
    setupScript: row.setupScript,
    setupScriptTrigger: (row.setupScriptTrigger as SetupTrigger | null) ?? null,
    teardownScript: row.teardownScript,
    devScript: row.devScript,
    devRestartScript: row.devRestartScript,
    dbUrlScript: row.dbUrlScript,
    dbSchemaMode: (row.dbSchemaMode as DbSchemaMode | null) ?? null,
    dbSchemaValue: row.dbSchemaValue,
    dbSchemaNotes: row.dbSchemaNotes,
    previewMode: (row.previewMode as PreviewMode | null) ?? null,
    previewValue: row.previewValue,
    browserRules: parseBrowserRules(row.browserRules),
    branchPrefix: row.branchPrefix,
  }
}

// Persist the per-repo run-target list (docs/workflows.md §2 — the DB fallback below a committed
// .acorn/config.toml). Accepts a JSON RunTarget[] string; blank clears. Shape-validated here so a
// bad save is rejected with a reason instead of surfacing later as a config error row.
export async function setRunTargets(db: AppDatabase, owner: string, repo: string, json: string): Promise<RepoPathResult> {
  const existing = await getRepoPath(db, owner, repo)
  if (!existing) return { ok: false, reason: 'Map a local checkout for this repo first.' }
  const value = json.trim() || null
  if (value) {
    try {
      const arr = JSON.parse(value) as unknown
      if (!Array.isArray(arr)) return { ok: false, reason: 'Run targets must be a JSON array.' }
      for (const t of arr) {
        const o = t as Record<string, unknown>
        if (!o || typeof o !== 'object' || typeof o.id !== 'string' || !o.id.trim() || typeof o.command !== 'string' || !o.command.trim())
          return { ok: false, reason: 'Each run target needs an "id" and a "command".' }
        if (o.url && o.urlCommand) return { ok: false, reason: `Target "${o.id}": pick one of "url" / "urlCommand".` }
      }
    } catch {
      return { ok: false, reason: 'Invalid JSON.' }
    }
  }
  await db
    .update(schema.repoPaths)
    .set({ runTargets: value, updatedAt: Date.now() })
    .where(and(eq(schema.repoPaths.owner, owner), eq(schema.repoPaths.repo, repo)))
  return { ok: true, repoPath: { ...existing, runTargets: value } }
}

// Persist a partial repo-config update (the machine-local DB fallback for lifecycle/build/preview
// config; committed .acorn/config.toml still wins at read time). Validation mirrors the old
// per-workspace PATCH route: trigger + preview-mode enums, a bare-port check, and browser-rule
// shape. An omitted field is untouched; '' (or [] for rules) clears.
export async function setRepoConfig(db: AppDatabase, owner: string, repo: string, patch: RepoConfigPatch): Promise<RepoPathResult> {
  const existing = await getRepoPath(db, owner, repo)
  if (!existing) return { ok: false, reason: 'Map a local checkout for this repo first.' }

  const set: Record<string, string | null> = {}
  const scalar = (v: string) => v.trim() || null
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
  if (patch.setupScriptTrigger !== undefined) {
    if (!['off', 'created', 'terminal'].includes(patch.setupScriptTrigger)) return { ok: false, reason: 'Invalid setup trigger.' }
    set.setupScriptTrigger = patch.setupScriptTrigger
  }
  if (patch.previewMode !== undefined) {
    if (patch.previewMode && !['url', 'port', 'script'].includes(patch.previewMode)) return { ok: false, reason: 'Invalid preview mode.' }
    set.previewMode = patch.previewMode || null
  }
  if (patch.previewValue !== undefined) set.previewValue = scalar(patch.previewValue)
  // A port preview value must be a bare 1-65535 (same guard the workspace route applied).
  const effectiveMode = patch.previewMode !== undefined ? patch.previewMode : existing.previewMode
  const effectiveValue = 'previewValue' in set ? set.previewValue : existing.previewValue
  if (effectiveMode === 'port' && effectiveValue != null) {
    const p = Number(effectiveValue)
    if (!/^\d{1,5}$/.test(effectiveValue) || p < 1 || p > 65535) return { ok: false, reason: 'Preview port must be 1-65535.' }
  }
  // Normalised on write so every reader (and the branch field the user sees) gets the same canonical
  // form, and an unslugifiable prefix ('///') clears rather than persisting an illegal branch stem.
  if (patch.branchPrefix !== undefined) set.branchPrefix = normalizeBranchPrefix(patch.branchPrefix) || null
  if (patch.browserRules !== undefined) {
    const rules: BrowserRule[] = Array.isArray(patch.browserRules) ? patch.browserRules.filter(isValidBrowserRule) : []
    set.browserRules = rules.length ? JSON.stringify(rules) : null
  }

  if (Object.keys(set).length === 0) return { ok: true, repoPath: existing }
  await db
    .update(schema.repoPaths)
    .set({ ...set, updatedAt: Date.now() })
    .where(and(eq(schema.repoPaths.owner, owner), eq(schema.repoPaths.repo, repo)))
  return { ok: true, repoPath: (await getRepoPath(db, owner, repo))! }
}

// Does a remote URL point at github.com/<owner>/<repo>? Accept https + ssh forms and an optional
// .git suffix; match case-insensitively (GitHub owners/repos are case-insensitive). Anchoring on
// a trailing boundary stops `owner/repo` from matching `owner/repo-2`.
export function remoteMatches(remotes: string, owner: string, repo: string): boolean {
  const re = new RegExp(`github\\.com[:/]${escapeRe(owner)}/${escapeRe(repo)}(\\.git)?(\\s|$)`, 'i')
  return re.test(remotes)
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Validate then persist a checkout for owner/repo (docs/workspaces-and-tasks.md): absolute existing dir, has a
// .git entry (dir or worktree file), and a GitHub remote matching owner/repo.
export async function setRepoPath(db: AppDatabase, owner: string, repo: string, path: string): Promise<RepoPathResult> {
  if (!isAbsolute(path)) return { ok: false, reason: 'Path must be absolute.' }
  if (!isDir(path)) return { ok: false, reason: 'Directory does not exist.' }
  if (!existsSync(join(path, '.git'))) return { ok: false, reason: 'Not a git checkout (no .git).' }

  let remotes: string
  try {
    const { stdout } = await exec('git', ['-C', path, 'remote', '-v'], { timeout: 5000 })
    remotes = stdout
  } catch {
    return { ok: false, reason: 'Could not read git remotes.' }
  }
  if (!remoteMatches(remotes, owner, repo)) {
    return { ok: false, reason: `No GitHub remote for ${owner}/${repo} in this checkout.` }
  }

  const now = Date.now()
  await db
    .insert(schema.repoPaths)
    .values({ owner, repo, path, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: [schema.repoPaths.owner, schema.repoPaths.repo], set: { path, updatedAt: now } })
  return { ok: true, repoPath: (await getRepoPath(db, owner, repo))! }
}

const isDir = (p: string): boolean => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}
