import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { searchInFiles } from './search'
import { listFilteredPaths } from './searchProcess'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'editor-search-'))
  roots.push(root)
  await mkdir(join(root, 'src', 'generated'), { recursive: true })
  await writeFile(join(root, 'src', 'good.tsx'), '🙂 needle\n')
  await writeFile(join(root, 'src', 'generated', 'bad.tsx'), 'needle\n')
  await writeFile(join(root, 'src', 'other.ts'), 'needle\n')
  await writeFile(join(root, 'outside.tsx'), 'needle\n')
  return { root, core: { tasks: { root: async () => root } } }
}

it('uses bundled ripgrep to scope results and apply excludes after includes', async () => {
  const { core } = await fixture()
  const result = await searchInFiles(core, 'task', 'needle', {
    folder: 'src', include: ['*.tsx'], exclude: ['**/generated/**'],
  })
  expect(result.files.map((file) => file.path)).toEqual(['src/good.tsx'])
  expect(result.files[0].hits[0]).toMatchObject({ line: 1, col: 4, endCol: 10 })
  const subtree = await searchInFiles(core, 'task', 'needle', { include: ['src/**'] })
  expect(subtree.files.every((file) => file.path.startsWith('src/'))).toBe(true)
  expect(subtree.files).toHaveLength(3)
})

it('confines scopes, reports missing folders, and treats option-like queries as text', async () => {
  const { root, core } = await fixture()
  const outside = await mkdtemp(join(tmpdir(), 'editor-search-outside-'))
  roots.push(outside)
  await symlink(outside, join(root, 'escape'))
  await expect(searchInFiles(core, 'task', 'needle', { folder: 'escape' })).rejects.toMatchObject({ code: 'invalid_scope' })
  await expect(searchInFiles(core, 'task', 'needle', { folder: 'missing' })).rejects.toMatchObject({ code: 'invalid_scope' })
  await expect(searchInFiles(core, 'task', 'needle', { folder: '../outside' })).rejects.toMatchObject({ code: 'invalid_scope' })
  await writeFile(join(root, 'src', '-dash.tsx'), '--files\n')
  const result = await searchInFiles(core, 'task', '--files', { folder: 'src', include: ['*.tsx'] })
  expect(result.files.map((file) => file.path)).toEqual(['src/-dash.tsx'])
  await expect(searchInFiles(core, 'task', 'needle', { include: ['['] })).rejects.toMatchObject({ code: 'invalid_filter' })
  await expect(listFilteredPaths(root, '.', ['*.tsx'], [], AbortSignal.abort())).rejects.toMatchObject({ code: 'cancelled' })
})

it('keeps hidden and ignored files out of default search, including in a Unicode option-like folder', async () => {
  const { root, core } = await fixture()
  await mkdir(join(root, '-scope ü'))
  await writeFile(join(root, '-scope ü', 'visible.tsx'), 'needle\n')
  await writeFile(join(root, '-scope ü', '.hidden.tsx'), 'needle\n')
  await writeFile(join(root, '-scope ü', 'ignored.tsx'), 'needle\n')
  await writeFile(join(root, '.gitignore'), 'ignored.tsx\n')
  await promisify(execFile)('git', ['init', '-q'], { cwd: root })
  const result = await searchInFiles(core, 'task', 'needle', { folder: '-scope ü', include: ['*.tsx'] })
  expect(result.files.map((file) => file.path)).toEqual(['-scope ü/visible.tsx'])
})
