import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import { memories } from '../node/schema'
import type { MemoryScope, MemoryType } from '../contract/library'

export type { MemoryScope, MemoryType } from '../contract/library'
export const MEMORY_TYPES: readonly MemoryType[] = ['convention', 'architecture', 'decision', 'fix', 'reference', 'feedback', 'task', 'user']

export type MemoryFile = {
  name: string
  description: string
  type: MemoryType
  originSessionId: string | null
  commitSha: string | null
  supersededBy: string | null
  createdAt: number
  body: string
}

export type MemorySource = { dir: string; scope: MemoryScope; projectId: string | null }

export const isValidMemoryName = (s: string): boolean => /^[a-z0-9][a-z0-9._-]*$/i.test(s) && !s.includes('..')

// Where acorn writes (docs/notes-and-memory.md § Memory). Every memory it accepts lands under the
// owner's private root, never inside a repo checkout, so a task's diff and its PR stay clear of
// them. Scope is about reach, not storage: a `projects/<projectId>` directory holds the memories
// that apply to one project, and through that project to its workspace, while the root holds the
// ones that apply wherever the owner is working.
export const privateMemoryRoot = (homeDir: string): string => join(homeDir, '.acorn', 'memory')

// The project id is a path segment here, so it goes through the same name check a memory file does.
export function projectMemoryDir(homeDir: string, projectId: string): string {
  if (!isValidMemoryName(projectId)) throw new Error('Invalid project id.')
  return join(privateMemoryRoot(homeDir), 'projects', projectId)
}

export const contentHashId = (name: string, body: string, description: string): string =>
  createHash('sha256').update(`${name}\n${description}\n${body}`).digest('hex').slice(0, 24)

// --- Frontmatter round-trip (Claude Code's convention: name/description + nested metadata) ---

export function serializeMemory(mem: MemoryFile): string {
  const lines = [
    '---',
    `name: ${mem.name}`,
    `description: ${mem.description}`,
    'metadata:',
    `  type: ${mem.type}`,
    ...(mem.originSessionId ? [`  originSessionId: ${mem.originSessionId}`] : []),
    ...(mem.commitSha ? [`  commitSha: ${mem.commitSha}`] : []),
    ...(mem.supersededBy ? [`  supersededBy: ${mem.supersededBy}`] : []),
    `  createdAt: ${mem.createdAt}`,
    '---',
    '',
  ]
  return lines.join('\n') + mem.body
}

export function parseMemory(text: string, fallbackName: string): MemoryFile {
  const fields: Record<string, string> = {}
  let body = text
  if (text.startsWith('---\n')) {
    const end = text.indexOf('\n---', 4)
    if (end > 0) {
      for (const line of text.slice(4, end).split('\n')) {
        const m = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/)
        if (m) fields[m[2]] = m[3].trim() // flat + metadata-nested keys share one namespace (unique here)
      }
      body = text.slice(end + 4).replace(/^\n/, '')
    }
  }
  return {
    name: fields.name && isValidMemoryName(fields.name) ? fields.name : fallbackName,
    description: fields.description || body.split('\n').find((l) => l.trim() && !l.startsWith('#'))?.trim().slice(0, 200) || fallbackName,
    type: MEMORY_TYPES.includes(fields.type as MemoryType) ? (fields.type as MemoryType) : 'reference',
    originSessionId: fields.originSessionId || null,
    commitSha: fields.commitSha || null,
    supersededBy: fields.supersededBy || null,
    createdAt: Number(fields.createdAt) || 0,
    body,
  }
}

// --- Files ---

type ScannedMemory = MemoryFile & { path: string; updatedAt: number; scope: MemoryScope; projectId: string | null }

export async function scanMemoryDir(source: MemorySource): Promise<ScannedMemory[]> {
  const entries = await readdir(source.dir).catch(() => [] as string[])
  const out: ScannedMemory[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.md') || entry === 'MEMORY.md') continue
    const name = entry.slice(0, -3)
    if (!isValidMemoryName(name)) continue
    try {
      const file = join(source.dir, entry)
      const [text, st] = await Promise.all([readFile(file, 'utf8'), stat(file)])
      out.push({ ...parseMemory(text, name), path: file, updatedAt: st.mtimeMs, scope: source.scope, projectId: source.projectId })
    } catch {
      // unreadable file → skipped
    }
  }
  return out
}

// MEMORY.md: one line per memory, the index injected at agent launch.
export const renderMemoryIndex = (entries: Pick<MemoryFile, 'name' | 'description'>[]): string =>
  entries.length
    ? entries
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((m) => `- [${m.name}](${m.name}.md) — ${m.description}`)
        .join('\n') + '\n'
    : ''

async function atomicWrite(file: string, text: string): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tmp, text, 'utf8')
  try {
    await rename(tmp, file)
  } catch (e) {
    await unlink(tmp).catch(() => {})
    throw e
  }
}

export async function regenerateIndexFile(dir: string): Promise<void> {
  const all = await scanMemoryDir({ dir, scope: 'project', projectId: null })
  await atomicWrite(join(dir, 'MEMORY.md'), renderMemoryIndex(all))
}

// Writes a memory file into a dir. Callers hand it projectMemoryDir() or privateMemoryRoot(), which
// is what keeps written memory out of every repo checkout. Regenerates that dir's MEMORY.md
// afterward.
export async function writeMemoryFile(dir: string, mem: MemoryFile): Promise<{ path: string }> {
  if (!isValidMemoryName(mem.name)) throw new Error('Invalid memory name.')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${mem.name}.md`)
  await atomicWrite(path, serializeMemory(mem))
  await regenerateIndexFile(dir)
  return { path }
}

// --- The derived SQLite index ---

export async function reconcileMemories(db: PluginDatabase, sources: MemorySource[]): Promise<void> {
  const scanned = (await Promise.all(sources.map(scanMemoryDir))).flat()
  // Same (scope, projectId, name) across checkouts → newest updatedAt wins.
  const winners = new Map<string, ScannedMemory>()
  for (const m of scanned) {
    const key = `${m.scope}\0${m.projectId ?? ''}\0${m.name}`
    const cur = winners.get(key)
    if (!cur || m.updatedAt > cur.updatedAt) winners.set(key, m)
  }
  const rows = [...winners.values()].map((m) => ({
    id: contentHashId(m.name, m.body, m.description),
    scope: m.scope,
    projectId: m.projectId,
    name: m.name,
    type: m.type,
    description: m.description,
    body: m.body,
    path: m.path,
    originSessionId: m.originSessionId,
    commitSha: m.commitSha,
    supersededBy: m.supersededBy,
    createdAt: m.createdAt || Math.round(m.updatedAt),
    updatedAt: Math.round(m.updatedAt),
  }))
  const prior = await db.select({ id: memories.id, lastAccessedAt: memories.lastAccessedAt, accessCount: memories.accessCount }).from(memories)
  const stats = new Map(prior.map((p) => [p.id, p]))
  await db.delete(memories)
  await db.run(sql`DELETE FROM memories_fts`)
  for (const row of rows) {
    const stat0 = stats.get(row.id)
    await db.insert(memories).values({ ...row, lastAccessedAt: stat0?.lastAccessedAt ?? null, accessCount: stat0?.accessCount ?? 0 }).onConflictDoNothing()
    await db.run(sql`INSERT INTO memories_fts (id, name, description, body) VALUES (${row.id}, ${row.name}, ${row.description}, ${row.body})`)
  }
}

// One row of the derived index. Named because the contract (contract/knowledge.ts) states it and a
// bare `typeof memories.$inferSelect` there would import the schema into a type-only file.
export type MemoryRow = typeof memories.$inferSelect

export type MemoryHit = MemoryRow & { rank: number }

// Recall bookkeeping (docs/notes-and-memory.md § Memory).
async function touchMemories(db: PluginDatabase, ids: string[]): Promise<void> {
  if (!ids.length) return
  await db
    .update(memories)
    .set({ lastAccessedAt: Date.now(), accessCount: sql`${memories.accessCount} + 1` })
    .where(inArray(memories.id, ids))
}

// FTS5 BM25 search, project-scoped: project rows for this project + private rows. Query terms are quoted so
// user input can't inject FTS syntax.
export async function searchMemories(db: PluginDatabase, query: string, opts: { projectId?: string | null; type?: MemoryType; limit?: number }): Promise<MemoryHit[]> {
  const terms = query
    .split(/\s+/)
    .map((t) => t.replace(/"/g, ''))
    .filter(Boolean)
    .map((t) => `"${t}"`)
    .join(' ')
  if (!terms) return []
  const matches = await db.all<{ id: string; rank: number }>(sql`SELECT id, rank FROM memories_fts WHERE memories_fts MATCH ${terms} ORDER BY rank LIMIT 50`)
  if (!matches.length) return []
  const rankById = new Map(matches.map((m) => [m.id, m.rank]))
  const rows = await db.select().from(memories).where(inArray(memories.id, [...rankById.keys()]))
  const hits = rows
    .filter((r) => (opts.projectId ? r.projectId === opts.projectId || r.scope === 'private' : true))
    .filter((r) => (opts.type ? r.type === opts.type : true))
    .filter((r) => !r.supersededBy)
    .map((r) => ({ ...r, rank: rankById.get(r.id) ?? 0 }))
    .sort((a, b) => a.rank - b.rank || b.updatedAt - a.updatedAt) // bm25 rank: lower = better
    .slice(0, opts.limit ?? 10)
  await touchMemories(db, hits.map((h) => h.id))
  return hits
}

// One memory by name (the memory_get read path), project-scoped like listMemories. Reading it bumps
// the recall stats.
export async function getMemory(db: PluginDatabase, opts: { projectId?: string | null; name: string }): Promise<MemoryRow | null> {
  const match = (await listMemories(db, { projectId: opts.projectId })).find((m) => m.name === opts.name) ?? null
  if (match) await touchMemories(db, [match.id])
  return match
}

export async function listMemories(db: PluginDatabase, opts: { projectId?: string | null; type?: MemoryType }): Promise<MemoryRow[]> {
  const rows = await db
    .select()
    .from(memories)
    .where(opts.type ? and(eq(memories.type, opts.type)) : undefined)
  return rows.filter((r) => (opts.projectId ? r.projectId === opts.projectId || r.scope === 'private' : true)).sort((a, b) => a.name.localeCompare(b.name))
}

// The always-safe injection slice: the index lines plus project-scoped feedback/convention names.
export async function memoryIndexSlice(db: PluginDatabase, projectId: string, cap = 30): Promise<{ name: string; description: string }[]> {
  const rows = await listMemories(db, { projectId })
  return rows.slice(0, cap).map((r) => ({ name: r.name, description: r.description }))
}

// Launch injection block, the push half (docs/notes-and-memory.md § Context integration): the
// MEMORY.md index slice plus the project-scoped feedback and convention bodies. Caps keep it
// compact, and MCP search covers the long tail.
export function formatMemoryInjection(
  slice: { name: string; description: string }[],
  keyMemories: { name: string; type: string; body: string }[],
  caps: { index?: number; bodies?: number; bodyChars?: number } = {},
): string | null {
  const indexCap = caps.index ?? 30
  const bodiesCap = caps.bodies ?? 5
  const bodyChars = caps.bodyChars ?? 1500
  if (!slice.length && !keyMemories.length) return null
  const lines: string[] = ['# Project memory (acorn) — ask for full bodies via memory_get']
  if (slice.length) {
    lines.push('', '## Index')
    for (const m of slice.slice(0, indexCap)) lines.push(`- ${m.name} — ${m.description}`)
    if (slice.length > indexCap) lines.push(`- …and ${slice.length - indexCap} more`)
  }
  const keys = keyMemories.slice(0, bodiesCap)
  if (keys.length) {
    lines.push('', '## Conventions & feedback (follow these)')
    for (const m of keys) {
      const body = m.body.trim()
      lines.push(`### ${m.name} (${m.type})`, body.length > bodyChars ? `${body.slice(0, bodyChars)}…` : body)
    }
  }
  return lines.join('\n')
}

// Standard source set: the private root, one directory per project under it, then any memory a repo
// keeps for itself. acorn writes only the first two. The repo directories stay readable so a team
// that checks shared memory into its own repo still gets it, and so memory written before the store
// moved is not lost.
//
// The per-project directories come from a readdir rather than the caller's project list: the
// directory name is the scope key, so a project acorn has since forgotten still reconciles instead
// of dropping out of the index.
export async function memorySources(
  activeWorktrees: { dir: string; projectId: string }[],
  checkouts: { id: string; path: string }[],
  homeDir: string,
): Promise<MemorySource[]> {
  const root = privateMemoryRoot(homeDir)
  const out: MemorySource[] = [{ dir: root, scope: 'private', projectId: null }]
  for (const id of await readdir(join(root, 'projects')).catch(() => [] as string[])) {
    if (isValidMemoryName(id)) out.push({ dir: join(root, 'projects', id), scope: 'project', projectId: id })
  }
  for (const w of activeWorktrees) out.push({ dir: join(w.dir, '.acorn', 'memory'), scope: 'project', projectId: w.projectId })
  for (const c of checkouts) out.push({ dir: join(c.path, '.acorn', 'memory'), scope: 'project', projectId: c.id })
  return out.filter((s, i, arr) => arr.findIndex((x) => x.dir === s.dir) === i)
}
