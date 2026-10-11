import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { encodeFileGuardPolicy, fileToolRefusal, type FileGuardPolicy } from './fileGuard'

// The file guard (docs/managed-agents/read-block.md § Claude's own file tools) over a real process, the
// way Claude Code runs it: hook input on stdin, exit code 2 and a reason on stderr to refuse.

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const ENTRY = resolve(appRoot, '../../apps/node/src/entries/file-guard.ts')

const run = (args: string[], stdin: string): Promise<{ code: number | null; stderr: string }> =>
  new Promise((resolvePromise) => {
    const child = spawn(process.execPath, ['--import', 'tsx', ENTRY, ...args], {
      cwd: appRoot,
      stdio: ['pipe', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk
    })
    child.on('close', (code) => resolvePromise({ code, stderr }))
    child.stdin.end(stdin)
  })

describe('the file guard', () => {
  let root: string
  let policy: FileGuardPolicy
  beforeAll(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'acorn-file-guard-')))
    const data = join(root, 'data')
    mkdirSync(join(data, 'worktrees', 'task-1'), { recursive: true })
    writeFileSync(join(data, 'core.sqlite'), 'fake')
    symlinkSync(data, join(root, 'data-alias'))
    // The policy names the data root through the link, as a Node started on an aliased path would.
    policy = {
      dataDir: [join(root, 'data-alias')],
      read: [join(data, 'worktrees', 'task-1')],
      write: [join(data, 'worktrees', 'task-1')],
      writeDenied: [],
    }
  })
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('judges a path by where it really lands, for both spellings of the data root', () => {
    for (const path of [
      join(root, 'data', 'core.sqlite'),
      join(root, 'data-alias', 'core.sqlite'),
      join(root, 'data', 'not-yet', 'new.key'),
    ]) {
      expect(fileToolRefusal(policy, { tool_name: 'Read', tool_input: { file_path: path } })).toMatch(/data folder/)
    }
    expect(fileToolRefusal(policy, { tool_name: 'Glob', tool_input: { pattern: `${root}/data/*.sqlite` } })).toMatch(
      /data folder/,
    )
    expect(
      fileToolRefusal(policy, {
        tool_name: 'Read',
        tool_input: { file_path: 'notes.md' },
        cwd: join(root, 'data', 'worktrees', 'task-1'),
      }),
    ).toBeNull()
    expect(fileToolRefusal(policy, { tool_name: 'Bash', tool_input: { command: 'ls' } })).toMatch(/isn't a file tool/)
  })

  it('exits 2 with a reason to refuse, 0 to allow, and refuses what it cannot read', async () => {
    const encoded = encodeFileGuardPolicy(policy)
    const refused = await run(
      [encoded],
      JSON.stringify({ tool_name: 'Write', tool_input: { file_path: join(root, 'data', '.env') } }),
    )
    expect(refused).toEqual({ code: 2, stderr: expect.stringContaining("Acorn's data folder") })
    expect(
      await run(
        [encoded],
        JSON.stringify({
          tool_name: 'Write',
          tool_input: { file_path: join(root, 'data', 'worktrees', 'task-1', 'a.ts') },
        }),
      ),
    ).toEqual({ code: 0, stderr: '' })
    expect((await run([encoded], 'not json')).code).toBe(2)
    expect((await run([], '{}')).code).toBe(2)
  })
})
