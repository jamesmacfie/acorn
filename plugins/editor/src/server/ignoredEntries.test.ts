import { afterEach, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveInRoot } from '@acorn/plugin-api/testkit'
import { ignoredEntries } from './ignoredEntries'

const run = promisify(execFile)
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

it('reads ignore rules in one filename-safe batch and keeps non-Git listings usable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'editor-ignore-'))
  roots.push(root)
  await mkdir(join(root, 'build'))
  await writeFile(join(root, '.gitignore'), 'build/\nline?break\n')
  await run('git', ['init', '-q'], { cwd: root })
  const core = { tasks: { root: async () => root }, fs: { resolveInRoot } }
  const result = await ignoredEntries(core, 'task', '', ['build', 'source.ts', 'line\nbreak'])
  expect(result).toEqual({ available: true, ignored: ['build', 'line\nbreak'] })
  expect(await ignoredEntries(core, 'task', '', ['../escape'])).toMatchObject({ available: false })
  const other = await mkdtemp(join(tmpdir(), 'editor-nongit-'))
  roots.push(other)
  expect(await ignoredEntries({ ...core, tasks: { root: async () => other } }, 'task', '', ['file'])).toMatchObject({
    available: false,
  })
})
