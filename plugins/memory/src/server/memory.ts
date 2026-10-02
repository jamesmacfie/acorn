import { createHash, randomUUID } from 'node:crypto'
import { readdir, readFile, rename, lstat, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MemoryScope, MemoryType } from '../contract/library'

export type { MemoryScope, MemoryType } from '../contract/library'
export const DIRECT_MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'] as const
export const normalizeMemoryType = (type: string): typeof DIRECT_MEMORY_TYPES[number] =>
  ['convention', 'architecture', 'decision', 'fix', 'task'].includes(type) ? 'project'
    : DIRECT_MEMORY_TYPES.includes(type as typeof DIRECT_MEMORY_TYPES[number]) ? type as typeof DIRECT_MEMORY_TYPES[number] : 'reference'

export const MEMORY_TYPES: readonly MemoryType[] = ['convention', 'architecture', 'decision', 'fix', 'reference', 'feedback', 'task', 'user', 'project']

export type MemoryFile = {
  name: string
  description: string
  type: MemoryType
  originSessionId: string | null
  commitSha: string | null
  supersededBy: string | null
  createdAt: number
  body: string
  updatedAt?: number
  updatedBy?: string
}

export type MemorySource = { dir: string; scope: MemoryScope; projectId: string | null }

export const isValidMemoryName = (s: string): boolean => /^[a-z0-9][a-z0-9._-]*$/i.test(s) && !s.includes('..')

// Where acorn writes (docs/notes-and-memory.md § Memory). Every memory it accepts lands under the
// owner's private root, never inside a repo checkout, so a task's diff and its PR stay clear of
// them. Scope is about reach, not storage: a `projects/<projectId>` directory holds the memories
// that apply to one project, and through that project to its workspace, while the root holds the
// ones that apply wherever the owner is working.
export const privateMemoryRoot = (homeDir: string): string => process.env.ACORN_DATA_DIR
  ? join(process.env.ACORN_DATA_DIR, 'memory')
  : join(homeDir, '.acorn', 'memory')

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
    ...(mem.updatedAt ? [`  updatedAt: ${new Date(mem.updatedAt).toISOString()}`] : []),
    ...(mem.updatedBy ? [`  updatedBy: ${mem.updatedBy}`] : []),
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
    type: normalizeMemoryType(fields.type),
    originSessionId: fields.originSessionId || null,
    commitSha: fields.commitSha || null,
    supersededBy: fields.supersededBy || null,
    createdAt: Number(fields.createdAt) || 0,
    body,
    ...(fields.updatedAt ? { updatedAt: Date.parse(fields.updatedAt) || 0 } : {}),
    ...(fields.updatedBy ? { updatedBy: fields.updatedBy } : {}),
  }
}

// --- Files ---

type ScannedMemory = MemoryFile & { path: string; updatedAt: number; scope: MemoryScope; projectId: string | null }

export async function scanMemoryDir(source: MemorySource): Promise<ScannedMemory[]> {
  const info = await lstat(source.dir).catch(() => null)
  if (!info?.isDirectory() || info.isSymbolicLink()) return []
  const entries = await readdir(source.dir).catch(() => [] as string[])
  const out: ScannedMemory[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.md') || entry === 'MEMORY.md') continue
    const name = entry.slice(0, -3)
    if (!isValidMemoryName(name)) continue
    try {
      const file = join(source.dir, entry)
      const info = await lstat(file)
      if (!info.isFile() || info.isSymbolicLink()) continue
      const [text, st] = await Promise.all([readFile(file, 'utf8'), stat(file)])
      out.push({ ...parseMemory(text, name), name, path: file, updatedAt: st.mtimeMs, scope: source.scope, projectId: source.projectId })
    } catch {
      // unreadable file → skipped
    }
  }
  return out
}

// MEMORY.md: one line per memory, the index injected at agent launch.
export const renderMemoryIndex = (entries: (Pick<MemoryFile, 'name' | 'description'> & { updatedAt?: number | string })[]): string =>
  entries.length
    ? entries
        .slice()
        .sort((a, b) => {
          const updated = (value: number | string | undefined) => typeof value === 'number' ? value : value ? Date.parse(value) || 0 : 0
          return updated(b.updatedAt) - updated(a.updatedAt) || a.name.localeCompare(b.name)
        })
        .map((m) => `- [${m.name}](${m.name}.md) — ${m.description}`)
        .join('\n') + '\n'
    : ''

export async function atomicWrite(file: string, text: string): Promise<void> {
  const tmp = `${file}.tmp-${randomUUID()}`
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
