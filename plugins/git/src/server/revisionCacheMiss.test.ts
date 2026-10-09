import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { CoreServices } from '@acorn/plugin-api/node'

const miss = vi.hoisted(() => ({ next: false }))
vi.mock('@acorn/diff-document/document', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@acorn/diff-document/document')>()
  return { ...actual, documentCache: (bytes: number) => {
    const cache = actual.documentCache(bytes)
    return { ...cache, get: (key: string) => {
      if (miss.next) { miss.next = false; return undefined }
      return cache.get(key)
    } }
  } }
})

import { revision, segments } from './revision'

let root = ''
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); root = ''; miss.next = false })

it('aborts a cache-miss re-read instead of serving or caching its patch', async () => {
  root = mkdtempSync(join(tmpdir(), 'acorn-revision-miss-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  git('init', '-q')
  git('config', 'user.name', 'Acorn Test')
  git('config', 'user.email', 'test@acorn.dev')
  writeFileSync(join(root, 'file.txt'), 'first\n')
  git('add', '.')
  git('commit', '-qm', 'Root')
  const id = git('rev-parse', 'HEAD')
  const controller = new AbortController()
  let patchReads = 0
  const core = {
    projects: { byId: async () => ({ id: 'project', path: root }) },
    git: { git: async (args: readonly string[], opts: { signal?: AbortSignal; stdin?: string }) => {
      if (args.includes('--patch')) {
        patchReads++
        if (patchReads === 2) controller.abort()
      }
      opts.signal?.throwIfAborted()
      return { code: 0, stdout: execFileSync('git', [...args], { cwd: root, encoding: 'utf8', input: opts.stdin ?? '' }), stderr: '' }
    } },
  } as unknown as Pick<CoreServices, 'git' | 'projects'>
  const detail = await revision(core, 'project', id)
  const file = detail.topology.files[0]!
  const request = { path: file.path, patchKey: file.patchKey!, ordinal: 0 }
  miss.next = true
  await expect(segments(core, 'project', id, null, [request], controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  expect(patchReads).toBe(2)
  expect((await segments(core, 'project', id, null, [request]))[0]?.rows.length).toBeGreaterThan(0)
  expect(patchReads).toBe(3)
})
