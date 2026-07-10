// Memory system (docs/notes-and-memory.md): markdown files are TRUTH — `<checkout>/.acorn/memory/*.md`
// (repo scope, committed, PR-reviewed) and `~/.acorn/memory/*.md` (operator-private) — with a
// MEMORY.md index per dir. SQLite (`memories` + `memories_fts`) is a DERIVED index, reconciled on
// change from every active worktree + the primary checkout: ids are content hashes so the same
// file in N checkouts collapses to one row; same (scope, repo, name) with different bodies →
// newest updatedAt wins (contradictions are what supersededBy chains are for). Retrieval is FTS5
// BM25 (porter) with repo-scope filter — keyword-first, no embeddings (ponytail: add RRF/vectors
// only if keyword recall demonstrably misses).
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { AppDatabase } from '../../../core/server/db'
import { schema } from '../../../core/server/db'

export type MemoryType = 'convention' | 'architecture' | 'decision' | 'fix' | 'reference' | 'feedback' | 'task' | 'user'
export const MEMORY_TYPES: readonly MemoryType[] = ['convention', 'architecture', 'decision', 'fix', 'reference', 'feedback', 'task', 'user']

export type MemoryScope = 'repo' | 'private'

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

export type MemorySource = { dir: string; scope: MemoryScope; repo: string | null }

export const isValidMemoryName = (s: string): boolean => /^[a-z0-9][a-z0-9._-]*$/i.test(s) && !s.includes('..')

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

type ScannedMemory = MemoryFile & { path: string; updatedAt: number; scope: MemoryScope; repo: string | null }

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
      out.push({ ...parseMemory(text, name), path: file, updatedAt: st.mtimeMs, scope: source.scope, repo: source.repo })
    } catch {
      // unreadable file → skipped
    }
  }
  return out
}

// MEMORY.md: one line per memory — the index injected at agent launch (12 P2).
export const renderMemoryIndex = (memories: Pick<MemoryFile, 'name' | 'description'>[]): string =>
  memories.length
    ? memories
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
  const all = await scanMemoryDir({ dir, scope: 'repo', repo: null })
  await atomicWrite(join(dir, 'MEMORY.md'), renderMemoryIndex(all))
}

// Write a memory file into a dir (the task WORKTREE for repo scope — never the user's primary
// checkout — or ~/.acorn/memory for private) and regenerate that dir's MEMORY.md.
export async function writeMemoryFile(dir: string, mem: MemoryFile): Promise<{ path: string }> {
  if (!isValidMemoryName(mem.name)) throw new Error('Invalid memory name.')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${mem.name}.md`)
  await atomicWrite(path, serializeMemory(mem))
  await regenerateIndexFile(dir)
  return { path }
}

// --- The derived SQLite index ---

export async function reconcileMemories(db: AppDatabase, sources: MemorySource[]): Promise<void> {
  const scanned = (await Promise.all(sources.map(scanMemoryDir))).flat()
  // Same (scope, repo, name) across checkouts → newest updatedAt wins.
  const winners = new Map<string, ScannedMemory>()
  for (const m of scanned) {
    const key = `${m.scope}\0${m.repo ?? ''}\0${m.name}`
    const cur = winners.get(key)
    if (!cur || m.updatedAt > cur.updatedAt) winners.set(key, m)
  }
  const rows = [...winners.values()].map((m) => ({
    id: contentHashId(m.name, m.body, m.description),
    scope: m.scope,
    repo: m.repo,
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
  // Full rebuild (ponytail: hundreds of files at most). Preserve access stats by id.
  const prior = await db.select({ id: schema.memories.id, lastAccessedAt: schema.memories.lastAccessedAt, accessCount: schema.memories.accessCount }).from(schema.memories)
  const stats = new Map(prior.map((p) => [p.id, p]))
  await db.delete(schema.memories)
  await db.run(sql`DELETE FROM memories_fts`)
  for (const row of rows) {
    const stat0 = stats.get(row.id)
    await db.insert(schema.memories).values({ ...row, lastAccessedAt: stat0?.lastAccessedAt ?? null, accessCount: stat0?.accessCount ?? 0 }).onConflictDoNothing()
    await db.run(sql`INSERT INTO memories_fts (id, name, description, body) VALUES (${row.id}, ${row.name}, ${row.description}, ${row.body})`)
  }
}

export type MemoryHit = typeof schema.memories.$inferSelect & { rank: number }

// Recall bookkeeping (docs/notes-and-memory.md): a memory that was actually READ (search hit /
// memory_get) bumps lastAccessedAt + accessCount — the inputs for future decay/ranking. Listing
// the index does NOT count as a read. Stats survive reconciles by content-hash id.
async function touchMemories(db: AppDatabase, ids: string[]): Promise<void> {
  if (!ids.length) return
  await db
    .update(schema.memories)
    .set({ lastAccessedAt: Date.now(), accessCount: sql`${schema.memories.accessCount} + 1` })
    .where(inArray(schema.memories.id, ids))
}

// FTS5 BM25 search, repo-scoped: repo rows for this repo + private rows. Query terms are quoted so
// user input can't inject FTS syntax.
export async function searchMemories(db: AppDatabase, query: string, opts: { repo?: string | null; type?: MemoryType; limit?: number }): Promise<MemoryHit[]> {
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
  const rows = await db.select().from(schema.memories).where(inArray(schema.memories.id, [...rankById.keys()]))
  const hits = rows
    .filter((r) => (opts.repo ? r.repo === opts.repo || r.scope === 'private' : true))
    .filter((r) => (opts.type ? r.type === opts.type : true))
    .filter((r) => !r.supersededBy)
    .map((r) => ({ ...r, rank: rankById.get(r.id) ?? 0 }))
    .sort((a, b) => a.rank - b.rank || b.updatedAt - a.updatedAt) // bm25 rank: lower = better
    .slice(0, opts.limit ?? 10)
  await touchMemories(db, hits.map((h) => h.id))
  return hits
}

// One memory by name (the memory_get read path), repo-scoped like listMemories. Reading it bumps
// the recall stats.
export async function getMemory(db: AppDatabase, opts: { repo?: string | null; name: string }): Promise<typeof schema.memories.$inferSelect | null> {
  const match = (await listMemories(db, { repo: opts.repo })).find((m) => m.name === opts.name) ?? null
  if (match) await touchMemories(db, [match.id])
  return match
}

export async function listMemories(db: AppDatabase, opts: { repo?: string | null; type?: MemoryType }): Promise<(typeof schema.memories.$inferSelect)[]> {
  const rows = await db
    .select()
    .from(schema.memories)
    .where(opts.type ? and(eq(schema.memories.type, opts.type)) : undefined)
  return rows.filter((r) => (opts.repo ? r.repo === opts.repo || r.scope === 'private' : true)).sort((a, b) => a.name.localeCompare(b.name))
}

// The always-safe injection slice (12 P2): the index lines + repo-scoped feedback/convention names.
export async function memoryIndexSlice(db: AppDatabase, repo: string, cap = 30): Promise<{ name: string; description: string }[]> {
  const rows = await listMemories(db, { repo })
  return rows.slice(0, cap).map((r) => ({ name: r.name, description: r.description }))
}

// Launch injection block (docs/notes-and-memory.md, the push half): the MEMORY.md index slice (cheap,
// always-safe) plus the repo-scoped feedback/convention BODIES (the rules an agent must never
// miss). Caps keep it compact — injection is recall for the high-value slice; MCP search is
// recall for the long tail.
export function formatMemoryInjection(
  slice: { name: string; description: string }[],
  keyMemories: { name: string; type: string; body: string }[],
  caps: { index?: number; bodies?: number; bodyChars?: number } = {},
): string | null {
  const indexCap = caps.index ?? 30
  const bodiesCap = caps.bodies ?? 5
  const bodyChars = caps.bodyChars ?? 1500
  if (!slice.length && !keyMemories.length) return null
  const lines: string[] = ['# Repo memory (acorn) — ask for full bodies via memory_get / read .acorn/memory/']
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

// Standard source set: every active worktree + each primary checkout + the private home dir.
export function memorySources(
  activeWorktrees: { dir: string; repo: string }[],
  checkouts: { dir: string; repo: string }[],
  homeDir: string,
): MemorySource[] {
  const out: MemorySource[] = []
  for (const w of activeWorktrees) out.push({ dir: join(w.dir, '.acorn', 'memory'), scope: 'repo', repo: w.repo })
  for (const c of checkouts) out.push({ dir: join(c.dir, '.acorn', 'memory'), scope: 'repo', repo: c.repo })
  out.push({ dir: join(homeDir, '.acorn', 'memory'), scope: 'private', repo: null })
  return out.filter((s, i, arr) => arr.findIndex((x) => x.dir === s.dir) === i && existsSync(s.dir.replace(/\/.acorn\/memory$/, '')))
}
