import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryStore } from './memoryStore'
import { importMemory, memoryImportPreview, memoryImportSources } from './memoryImport'

let root: string
let store: MemoryStore
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'memory-import-')); store = new MemoryStore(join(root, 'store')); vi.stubEnv('CLAUDE_CONFIG_DIR', join(root, 'claude')); vi.stubEnv('CLAUDE_CODE_PROJECT_DIR_NAME', '') })
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }) })
const sourceBody = 'Run the release pipeline.\r\nKeep the source line endings.'
const sourceText = '---\r\nname: "Release rules"\r\ndescription: "How to release"\r\ntype: architecture\r\n---\r\n' + sourceBody
const core = () => ({ projects: { byId: async () => ({ id: 'project-a', path: join(root, 'repo/worktree') }) }, git: { gitText: async () => join(root, 'repo/.git') } }) as never
const choice = (file: { name: string; sourceHash: string; destinationHash: string | null }, overwrite = false) => ({ name: file.name, sourceHash: file.sourceHash, destinationHash: file.destinationHash, overwrite })

it('discovers the main repository Claude folder, copies bodies and types, and leaves source and index untouched', async () => {
  const repo = join(root, 'repo')
  const claude = join(root, 'claude/projects', repo.replace(/[^a-zA-Z0-9]/g, '-'), 'memory')
  await mkdir(join(repo, 'worktree'), { recursive: true })
  await mkdir(join(repo, '.acorn/memory'), { recursive: true })
  await mkdir(claude, { recursive: true })
  await writeFile(join(claude, 'release.md'), sourceText)
  await writeFile(join(claude, 'MEMORY.md'), 'Source index stays intact.')
  await symlink(join(claude, 'release.md'), join(claude, 'link.md'))
  expect((await memoryImportSources(core(), 'project-a')).map((source) => source.id)).toEqual(['claude', 'checkout'])
  const preview = await memoryImportPreview(core(), store, 'project-a', 'claude')
  expect(preview).toMatchObject([{ name: 'release', type: 'project', description: 'How to release', body: sourceBody, collision: false }])
  const result = await importMemory(core(), store, 'project-a', 'claude', preview.map((file) => choice(file)))
  expect(result).toEqual({ imported: ['release'], skipped: [], errors: [] })
  expect((await store.get({ scope: 'project', projectId: 'project-a', name: 'release' }))?.body).toBe(sourceBody)
  expect(await readFile(join(store.root, 'projects/project-a/MEMORY.md'), 'utf8')).toContain('[release](release.md)')
  expect((await store.feed('project-a'))[0]).toMatchObject({ by: 'import', canUndo: true })
  expect(await readFile(join(claude, 'release.md'), 'utf8')).toBe(sourceText)
  expect(await readFile(join(claude, 'MEMORY.md'), 'utf8')).toBe('Source index stays intact.')
})

it('skips name collisions, requires an explicit overwrite, and refuses drift since preview', async () => {
  const source = join(root, 'repo/.acorn/memory')
  await mkdir(join(root, 'repo/worktree'), { recursive: true }); await mkdir(source, { recursive: true })
  await writeFile(join(source, 'release.md'), sourceText)
  const address = { scope: 'project' as const, projectId: 'project-a', name: 'release' }
  const original = { name: 'release', description: 'Existing rule', type: 'project' as const, body: 'Existing body.' }
  await store.write(address, original, { by: 'owner' })
  const [file] = await memoryImportPreview(core(), store, 'project-a', 'checkout')
  expect(file.collision).toBe(true)
  expect((await importMemory(core(), store, 'project-a', 'checkout', [choice(file)])).skipped).toEqual(['release'])
  expect((await store.get(address))?.body).toBe('Existing body.')
  await store.write(address, { ...original, body: 'Concurrent edit.', hash: file.destinationHash! }, { by: 'owner' })
  expect((await importMemory(core(), store, 'project-a', 'checkout', [choice(file, true)])).errors).toHaveLength(1)
  const [fresh] = await memoryImportPreview(core(), store, 'project-a', 'checkout')
  await writeFile(join(source, 'release.md'), sourceText + '\nChanged source.')
  expect((await importMemory(core(), store, 'project-a', 'checkout', [choice(fresh, true)])).errors).toHaveLength(1)
  const [latest] = await memoryImportPreview(core(), store, 'project-a', 'checkout')
  expect((await importMemory(core(), store, 'project-a', 'checkout', [choice(latest, true)])).imported).toEqual(['release'])
  expect((await store.history(address))[0].body).toBe('Concurrent edit.')
})
