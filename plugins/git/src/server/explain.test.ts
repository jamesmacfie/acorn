import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { CoreServices } from '@acorn/plugin-api/node'
import { explain } from './explain'

let folder = ''
afterEach(() => {
  if (folder) rmSync(folder, { recursive: true, force: true })
  folder = ''
})
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
function fixture() {
  folder = mkdtempSync(join(tmpdir(), 'acorn-explain-'))
  const root = join(folder, 'repo')
  mkdirSync(root)
  git(root, 'init', '-q')
  git(root, 'config', 'user.name', 'Acorn Test')
  git(root, 'config', 'user.email', 'test@acorn.dev')
  writeFileSync(join(root, 'tracked'), 'initial\n')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'Initial')
  return root
}
function service(root: string) {
  const calls: Array<{ args: readonly string[]; maxOutputBytes?: number }> = []
  const generateText = vi.fn<CoreServices['models']['generateText']>(async () => ({
    text: 'A useful summary',
    providerId: 'fixture',
    backendId: 'harness:fixture',
    modelId: 'fixture-model',
  }))
  const available = vi.fn<CoreServices['models']['available']>(async () => [
    {
      id: 'harness:fixture',
      kind: 'harness',
      label: 'Fixture',
      models: [{ id: 'fixture-model', label: 'Fixture model' }],
      defaultModelId: 'fixture-model',
    },
  ])
  const core = {
    projects: { byId: async (id: string) => (id === 'project' ? { id, path: root } : null) },
    models: { available, generateText },
    git: {
      git: async (
        args: readonly string[],
        opts: { cwd: string; signal?: AbortSignal; stdin?: string; maxOutputBytes?: number },
      ) => {
        calls.push({ args, maxOutputBytes: opts.maxOutputBytes })
        return await new Promise<{ code: number; stdout: string; stderr: string }>((done, fail) => {
          const child = spawn('git', [...args], { cwd: opts.cwd, signal: opts.signal })
          const stdout: Buffer[] = [],
            stderr: Buffer[] = []
          // Git can exit without reading stdin, which gives EPIPE. Its exit code is the answer, as in core's runner.
          child.stdin.on('error', () => undefined)
          child.stdin.end(opts.stdin ?? '')
          child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
          child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
          child.on('error', fail)
          child.on('close', (code) =>
            done({
              code: code ?? 1,
              stdout: Buffer.concat(stdout).toString(),
              stderr: Buffer.concat(stderr).toString(),
            }),
          )
        })
      },
    },
  } as unknown as Pick<CoreServices, 'git' | 'projects' | 'models'>
  return { core, calls, available, generateText }
}
const request = { backendId: 'harness:fixture', modelId: 'fixture-model', base: null }

it('uses the selected backend and bounded repository data without treating it as instructions', async () => {
  const root = fixture()
  const id = git(root, 'rev-parse', 'HEAD')
  const { core, calls, generateText } = service(root)
  const result = await explain(core, 'owner', 'project', 'commit', id, request, new AbortController().signal)
  expect(result.text).toBe('A useful summary')
  const sent = generateText.mock.calls[0]![0]
  expect(sent).toMatchObject({
    userId: 'owner',
    backendId: 'harness:fixture',
    input: { modelId: 'fixture-model', maxOutputTokens: 700 },
  })
  expect(sent.input.system).toContain('untrusted data')
  expect(JSON.parse(sent.input.prompt)).toMatchObject({ kind: 'commit', objectId: id })
  expect(Buffer.byteLength(sent.input.prompt)).toBeLessThan(60 << 10)
  expect(
    calls.filter(({ args }) => args.includes('--patch')).every(({ maxOutputBytes }) => maxOutputBytes! <= 8 << 20),
  ).toBe(true)
})

it('includes captured untracked stash content and names missing patch context', async () => {
  const root = fixture()
  writeFileSync(join(root, 'tracked'), 'changed\n')
  writeFileSync(join(root, 'captured.txt'), 'untracked witness\n')
  git(root, 'stash', 'push', '-u', '-m', 'Fixture')
  const id = git(root, 'rev-parse', 'stash@{0}')
  const base = git(root, 'rev-parse', 'stash@{0}^1')
  const { core, generateText } = service(root)
  const result = await explain(
    core,
    'owner',
    'project',
    'stash',
    id,
    { ...request, base },
    new AbortController().signal,
  )
  const context = JSON.parse(generateText.mock.calls[0]![0].input.prompt)
  expect(context.capturedUntrackedPatch).toContain('untracked witness')
  expect(result.omissions).toEqual([])
})

it('bounds large stash metadata, file summaries, and combined tracked and untracked patches', async () => {
  const root = fixture()
  for (let index = 0; index < 70; index++)
    writeFileSync(join(root, `file-${String(index).padStart(2, '0')}.txt`), 'before\n')
  writeFileSync(join(root, 'image.bin'), Buffer.from([0, 1, 2]))
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'Fixture files')
  for (let index = 0; index < 70; index++)
    writeFileSync(join(root, `file-${String(index).padStart(2, '0')}.txt`), `${'tracked content '.repeat(20)}\n`)
  writeFileSync(join(root, 'image.bin'), Buffer.from([0, 3, 4]))
  writeFileSync(join(root, 'captured.txt'), 'untracked content\n'.repeat(4_000))
  git(root, 'stash', 'push', '-u', '-m', 'long metadata '.repeat(1_300))
  const id = git(root, 'rev-parse', 'stash@{0}')
  const base = git(root, 'rev-parse', 'stash@{0}^1')
  const { core, generateText } = service(root)
  const result = await explain(
    core,
    'owner',
    'project',
    'stash',
    id,
    { ...request, base },
    new AbortController().signal,
  )
  const context = JSON.parse(generateText.mock.calls[0]![0].input.prompt)
  expect(Buffer.byteLength(context.metadata)).toBeLessThanOrEqual(12 << 10)
  expect(
    Buffer.byteLength(context.trackedPatch) + Buffer.byteLength(context.capturedUntrackedPatch),
  ).toBeLessThanOrEqual(40 << 10)
  expect(context.trackedPatch).toContain('tracked content')
  expect(context.capturedUntrackedPatch).toContain('untracked content')
  expect(result.omissions).toEqual(
    expect.arrayContaining([
      expect.stringContaining('file summaries omitted after 60'),
      expect.stringContaining('binary content omitted'),
      expect.stringContaining('Metadata truncated at 12 KiB'),
      expect.stringContaining('Captured untracked patch truncated'),
    ]),
  )
  expect(context.omissions).toEqual(result.omissions)
})

it('stops before follow-on stash reads when the roster read is cancelled', async () => {
  const root = fixture()
  writeFileSync(join(root, 'tracked'), 'changed\n')
  git(root, 'stash', 'push', '-m', 'Fixture')
  const id = git(root, 'rev-parse', 'stash@{0}')
  const base = git(root, 'rev-parse', 'stash@{0}^1')
  const { core, calls, generateText } = service(root)
  const controller = new AbortController()
  const original = core.git.git
  core.git.git = async (args, options) => {
    const result = await original(args, options)
    if (args[0] === 'stash' && args[1] === 'list') controller.abort()
    return result
  }
  await expect(
    explain(core, 'owner', 'project', 'stash', id, { ...request, base }, controller.signal),
  ).rejects.toMatchObject({ name: 'AbortError' })
  expect(calls.some(({ args }) => args[0] === 'rev-list')).toBe(false)
  expect(generateText).not.toHaveBeenCalled()
})

it('names a patch clipped by the public Git process output limit', async () => {
  const root = fixture(),
    id = git(root, 'rev-parse', 'HEAD')
  const { core } = service(root)
  const original = core.git.git
  core.git.git = async (args, options) => {
    const result = await original(args, options)
    return args.includes('--patch') ? { ...result, truncated: true } : result
  }
  const result = await explain(core, 'owner', 'project', 'commit', id, request, new AbortController().signal)
  expect(result.omissions).toContain('Tracked patch truncated at 40 KiB.')
})

it('rejects unavailable backend and model before spending a call', async () => {
  const root = fixture(),
    id = git(root, 'rev-parse', 'HEAD')
  const { core, generateText } = service(root)
  await expect(
    explain(
      core,
      'owner',
      'project',
      'commit',
      id,
      { ...request, backendId: 'harness:gone' },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: 'model_unavailable' })
  await expect(
    explain(core, 'owner', 'project', 'commit', id, { ...request, modelId: 'gone' }, new AbortController().signal),
  ).rejects.toMatchObject({ code: 'model_unavailable' })
  expect(generateText).not.toHaveBeenCalled()
})

it('passes cancellation to the model and does not return late output; provider errors remain failures', async () => {
  const root = fixture(),
    id = git(root, 'rev-parse', 'HEAD')
  const { core, generateText } = service(root)
  const controller = new AbortController()
  generateText.mockImplementationOnce(async ({ input }) => {
    controller.abort()
    expect(input.signal?.aborted).toBe(true)
    return { text: 'late', providerId: 'fixture', backendId: 'harness:fixture', modelId: 'fixture-model' }
  })
  await expect(explain(core, 'owner', 'project', 'commit', id, request, controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  })
  generateText.mockRejectedValueOnce(new Error('provider failed'))
  await expect(explain(core, 'owner', 'project', 'commit', id, request, new AbortController().signal)).rejects.toThrow(
    'provider failed',
  )
})
