import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { serializeMemory, type MemoryType } from './memory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerKnowledgeChannel } from './knowledgeChannel'

describe('memory route task scope resolution', () => {
  it('resolves only the task project and fails closed when its task or project disappears', async () => {
    const load = vi.fn().mockResolvedValueOnce({ projectId: 'project-a' }).mockResolvedValueOnce(undefined).mockResolvedValueOnce({ projectId: 'missing' }).mockResolvedValueOnce({ projectId: null })
    const byId = vi.fn().mockResolvedValueOnce({ id: 'project-a' }).mockResolvedValueOnce(undefined)
    const runtime = registerKnowledgeChannel({ tasks: { load }, projects: { byId } } as never, {})
    expect(await runtime.route.taskMemoryScope('task-a')).toEqual({ projectId: 'project-a' })
    expect(await runtime.route.taskMemoryScope('missing-task')).toBeNull()
    expect(await runtime.route.taskMemoryScope('orphan-task')).toBeNull()
    expect(await runtime.route.taskMemoryScope('private-only-task')).toEqual({ projectId: null })
    expect(load.mock.calls).toEqual([['task-a'], ['missing-task'], ['orphan-task'], ['private-only-task']])
    expect(byId.mock.calls).toEqual([['project-a'], ['missing']])
    // Scope checks only need task and project resolution.
  })

  it('propagates scope lookup failures to the route denial boundary', async () => {
    const load = vi.fn().mockRejectedValue(new Error('scope lookup failed'))
    const runtime = registerKnowledgeChannel({ tasks: { load } } as never, {})
    await expect(runtime.route.taskMemoryScope('task-a')).rejects.toThrow('scope lookup failed')
  })
})

describe('memory page reads current scope files', () => {
  let dataRoot: string
  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'acorn-memory-reads-'))
    vi.stubEnv('ACORN_DATA_DIR', dataRoot)
  })
  afterEach(async () => { vi.unstubAllEnvs(); await rm(dataRoot, { recursive: true, force: true }) })

  it('isolates projects, finds body-only terms, reflects external changes, and leaves retired databases unread', async () => {
    const root = join(dataRoot, 'memory')
    const runtime = registerKnowledgeChannel({
      tasks: { active: async () => [{ projectId: 'project-a', worktreePath: join(dataRoot, 'worktree') }] },
      projects: { checkouts: async () => [{ id: 'project-a', path: join(dataRoot, 'checkout') }] },
    } as never, {})
    const file = (name: string, body: string, type: MemoryType = 'project') => serializeMemory({
      name, description: 'A saved fact', body, type, createdAt: 10,
      originSessionId: null, commitSha: null, supersededBy: null,
    })
    for (const dir of [root, join(root, 'projects/project-a'), join(root, 'projects/project-b'), join(dataRoot, 'worktree/.acorn/memory'), join(dataRoot, 'checkout/.acorn/memory'), join(dataRoot, 'plugins')]) await mkdir(dir, { recursive: true })
    const projectPath = join(root, 'projects/project-a/shared-name.md')
    await writeFile(projectPath, file('shared-name', 'Unique-body-term alpha', 'architecture'))
    await writeFile(join(root, 'shared-name.md'), file('shared-name', 'Unique-body-term private', 'user'))
    await writeFile(join(root, 'projects/project-b/foreign.md'), file('foreign', 'Unique-body-term foreign'))
    for (const repo of ['worktree', 'checkout']) await writeFile(join(dataRoot, repo, '.acorn/memory/repo-only.md'), file('repo-only', 'Unique-body-term repo'))
    // Invalid bytes would fail a SQLite open, and their continued presence protects owner data.
    for (const plugin of ['memory', 'findings']) await writeFile(join(dataRoot, 'plugins', `${plugin}.sqlite`), 'retired owner data')
    expect(await runtime.route.memoryList('project-a')).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'shared-name', scope: 'private', type: 'user' }),
      expect.objectContaining({ name: 'shared-name', scope: 'project', projectId: 'project-a', type: 'project' }),
    ]))
    expect(await runtime.route.memoryList('project-a')).toHaveLength(2)
    expect(await runtime.route.memorySearch('unique-BODY-term alpha', 'project-a')).toMatchObject([{ scope: 'project', name: 'shared-name' }])
    expect(await runtime.route.memorySearch('unique-body-term', undefined)).toMatchObject([{ scope: 'private' }])
    expect(await runtime.route.memorySearch('unique-body-term', 'project-a', 'architecture')).toMatchObject([{ scope: 'project', type: 'project' }])
    await writeFile(projectPath, file('shared-name', 'Changed externally'))
    expect(await runtime.route.memorySearch('alpha', 'project-a')).toEqual([])
    expect(await runtime.route.memorySearch('changed externally', 'project-a')).toMatchObject([{ body: 'Changed externally' }])
    await unlink(projectPath)
    expect(await runtime.route.memoryList('project-a')).toMatchObject([{ scope: 'private' }])
    await writeFile(projectPath, await readFile(join(root, 'shared-name.md'), 'utf8'))
    const copies = await runtime.list('project-a')
    expect(copies).toHaveLength(2)
    expect(new Set(copies.map((copy) => copy.id)).size).toBe(2)
    for (const plugin of ['memory', 'findings']) expect(await readFile(join(dataRoot, 'plugins', `${plugin}.sqlite`), 'utf8')).toBe('retired owner data')
  })
})
