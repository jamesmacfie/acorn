import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, unlink } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { ToolError } from '@acorn/plugin-api/node'
import type { MemoryScope } from '../contract/library'
import { atomicWrite, isValidMemoryName, parseMemory, regenerateIndexFile, scanMemoryDir, serializeMemory } from './memory'
import { searchMemoryFiles } from './memorySearch'
import { validateMemoryWrite, type MemoryWrite } from './memorySafety'

export type MemoryAddress = { scope: MemoryScope; projectId: string | null; name: string }
export type MemoryAuthor = { by: 'agent' | 'owner'; sessionId?: string; taskId?: string }
export type MemoryChange = MemoryAddress & MemoryAuthor & {
  id: string
  at: string
  action: 'write' | 'delete' | 'restore'
  previousVersion: string | null
  hash: string | null
}
export const memoryHash = (text: string): string => createHash('sha256').update(text).digest('hex')

// The Node is the writer. Serialize all store instances for one root, including history and the log.
const pending = new Map<string, Promise<unknown>>()
async function serialized<T>(root: string, action: () => Promise<T>): Promise<T> {
  const previous = pending.get(root) ?? Promise.resolve()
  const next = previous.catch(() => {}).then(action)
  pending.set(root, next)
  try { return await next } finally { if (pending.get(root) === next) pending.delete(root) }
}

async function textIfPresent(path: string): Promise<string | null> {
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) throw new ToolError('bad_request', 'Memory must be a regular file.')
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export class MemoryStore {
  constructor(readonly root: string, private readonly announce: (projectId: string | null) => void = () => {}) {}

  directory(scope: MemoryScope, projectId: string | null): string {
    if (scope === 'private') return this.root
    if (!projectId || !isValidMemoryName(projectId)) throw new ToolError('bad_request', 'Project memory needs a project.')
    return join(this.root, 'projects', projectId)
  }

  private path(address: MemoryAddress): string {
    if (!isValidMemoryName(address.name) || address.name.toUpperCase() === 'MEMORY') throw new ToolError('bad_request', 'Invalid memory name.')
    return join(this.directory(address.scope, address.projectId), `${address.name}.md`)
  }

  // Refuse symlinks at every store-owned path boundary, including history and MEMORY.md.
  private async safeDirectory(dir: string, create = true): Promise<boolean> {
    const segments = relative(this.root, dir).split(sep).filter(Boolean)
    let current = this.root
    for (const segment of ['', ...segments]) {
      if (segment) current = join(current, segment)
      if (create) await mkdir(current, { recursive: true })
      const info = await lstat(current).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error })
      if (!info) return false
      if (!info.isDirectory() || info.isSymbolicLink()) throw new ToolError('bad_request', 'Memory directories cannot be symlinks.')
    }
    return true
  }

  async list(projectId: string | null, scope?: MemoryScope) {
    const sources = [
      ...(scope !== 'project' ? [{ dir: this.root, scope: 'private' as const, projectId: null }] : []),
      ...(projectId && scope !== 'private' ? [{ dir: this.directory('project', projectId), scope: 'project' as const, projectId }] : []),
    ]
    return (await Promise.all(sources.map(async (source) => await this.safeDirectory(source.dir, false) ? scanMemoryDir(source) : []))).flat().sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name))
  }

  async get(address: MemoryAddress) {
    const path = this.path(address)
    if (!await this.safeDirectory(this.directory(address.scope, address.projectId), false)) return null
    const text = await textIfPresent(path)
    return text === null ? null : { ...parseMemory(text, address.name), ...address, path, hash: memoryHash(text) }
  }

  async search(projectId: string | null, query: string, scope?: MemoryScope) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (!terms.length) return []
    return searchMemoryFiles(await this.list(projectId, scope), query).map((memory) => {
      const { rank } = memory
      const offset = Math.max(0, memory.body.toLowerCase().indexOf(terms[0]) - 60)
      return { name: memory.name, description: memory.description, type: memory.type, scope: memory.scope, updatedAt: memory.updatedAt, rank, excerpt: memory.body.slice(offset, offset + 300) }
    })
  }

  private historyDirectory(address: MemoryAddress): string {
    this.path(address)
    return address.scope === 'project'
      ? join(this.root, '.history', 'projects', address.projectId!, address.name)
      : join(this.root, '.history', address.name)
  }

  async changes(): Promise<MemoryChange[]> {
    const text = await textIfPresent(join(this.root, 'changes.jsonl'))
    return (text ?? '').split('\n').filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line) as MemoryChange] } catch { return [] }
    })
  }

  private async mutate(address: MemoryAddress, input: MemoryWrite | null, expectedHash: string | undefined, author: MemoryAuthor, action: MemoryChange['action']) {
    const path = this.path(address)
    await this.safeDirectory(this.directory(address.scope, address.projectId))
    await textIfPresent(join(this.directory(address.scope, address.projectId), 'MEMORY.md'))
    await textIfPresent(join(this.root, 'changes.jsonl'))
    const before = await textIfPresent(path)
    const currentHash = before === null ? null : memoryHash(before)
    if (currentHash !== (expectedHash ?? null)) throw new ToolError('conflict', `Memory changed. Current hash: ${currentHash ?? '(deleted)'}. Read memory_get and retry.`)
    if (!input && before === null) throw new ToolError('not_found', 'No such memory.')
    const at = new Date().toISOString()
    let previousVersion: string | null = null
    if (before !== null) {
      const history = this.historyDirectory(address)
      await this.safeDirectory(history)
      previousVersion = `${at.replaceAll(':', '-')}-${randomUUID()}.md`
      await atomicWrite(join(history, previousVersion), before)
      const versions = (await readdir(history)).filter((name) => name.endsWith('.md')).sort().reverse()
      for (const old of versions.slice(20)) await unlink(join(history, old))
    }
    const text = input ? serializeMemory({
      ...input, originSessionId: author.sessionId ?? null, commitSha: null, supersededBy: null,
      createdAt: before ? parseMemory(before, address.name).createdAt || Date.now() : Date.now(),
      updatedAt: Date.parse(at), updatedBy: author.by === 'agent' ? `agent:${author.sessionId}` : author.by,
    }) : null
    if (text !== null) await atomicWrite(path, text)
    else await unlink(path)
    await textIfPresent(join(this.directory(address.scope, address.projectId), 'MEMORY.md'))
    await regenerateIndexFile(this.directory(address.scope, address.projectId))
    const change: MemoryChange = { ...address, ...author, id: randomUUID(), at, action, previousVersion, hash: text === null ? null : memoryHash(text) }
    const changes = [...await this.changes(), change].slice(-1000)
    await atomicWrite(join(this.root, 'changes.jsonl'), changes.map((entry) => JSON.stringify(entry)).join('\n') + '\n')
    this.announce(address.scope === 'project' ? address.projectId : null)
    return { ...change, changeId: change.id, path, description: input?.description ?? parseMemory(before!, address.name).description }
  }

  async write(address: MemoryAddress, input: MemoryWrite, author: MemoryAuthor) {
    if (input.name !== address.name) throw new ToolError('bad_request', 'Memory name does not match its address.')
    validateMemoryWrite(input)
    return serialized(this.root, () => this.mutate(address, input, input.hash, author, 'write'))
  }

  delete(address: MemoryAddress, hash: string, author: MemoryAuthor) {
    return serialized(this.root, () => this.mutate(address, null, hash, author, 'delete'))
  }

  undo(changeId: string) {
    return serialized(this.root, async () => {
      const changes = await this.changes()
      const change = changes.find((entry) => entry.id === changeId)
      if (!change) throw new ToolError('not_found', 'No such memory change.')
      const latest = changes.findLast((entry) => entry.scope === change.scope && entry.projectId === change.projectId && entry.name === change.name)
      if (latest?.id !== change.id) throw new ToolError('conflict', 'A later change exists. Undo cannot overwrite it.')
      if (change.previousVersion && !/^[0-9TZ.-]+-[a-f0-9-]+\.md$/.test(change.previousVersion)) throw new ToolError('bad_request', 'Invalid history version.')
      if (change.previousVersion) await this.safeDirectory(this.historyDirectory(change), false)
      const previous = change.previousVersion ? await textIfPresent(join(this.historyDirectory(change), change.previousVersion)) : null
      if (change.previousVersion && !previous) throw new ToolError('not_found', 'This history version is no longer available.')
      const parsed = previous ? parseMemory(previous, change.name) : null
      const input = parsed ? { name: change.name, description: parsed.description, type: parsed.type as MemoryWrite['type'], body: parsed.body } : null
      if (input) validateMemoryWrite(input)
      return this.mutate(change, input, change.hash ?? undefined, { by: 'owner' }, 'restore')
    })
  }
}

export type MemoryStoreAccess = Pick<MemoryStore, 'list' | 'get' | 'search' | 'write' | 'delete' | 'undo'>
