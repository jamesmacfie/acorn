import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CoreServices } from '@acorn/plugin-api/node'
import { createLineBlame, relativeAge } from './lineBlame'

let folder = ''
afterEach(() => {
  if (folder) rmSync(folder, { recursive: true, force: true })
  folder = ''
})

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const revisionOf = (text: string) => createHash('sha256').update(text).digest('hex')
const signal = new AbortController().signal
const NOW = Date.UTC(2026, 9, 12)

function repository() {
  folder = mkdtempSync(join(tmpdir(), 'acorn-line-blame-'))
  const root = join(folder, 'repo')
  mkdirSync(root)
  git(root, 'init', '-q')
  git(root, 'config', 'user.name', 'Ada *Lovelace*')
  git(root, 'config', 'user.email', 'ada@example.com')
  return root
}

function commit(root: string, path: string, text: string, message: string, date = '2022-07-19T12:00:00Z') {
  writeFileSync(join(root, path), text)
  git(root, 'add', path)
  execFileSync('git', ['commit', '-q', '-m', message], {
    cwd: root,
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  })
}

/** The two core services blame needs, with every Git command it runs recorded. */
function core(root: string | null, onGit?: (args: readonly string[]) => void) {
  const commands: string[][] = []
  const services = {
    tasks: { root: async (taskId: string) => (taskId === 'task' ? root : null) },
    git: {
      git: async (args: readonly string[], opts: { cwd: string; signal?: AbortSignal }) => {
        commands.push([...args])
        onGit?.(args)
        return await new Promise<{ code: number; stdout: string; stderr: string; truncated: boolean }>((done, fail) => {
          const child = spawn('git', [...args], { cwd: opts.cwd, signal: opts.signal })
          const stdout: Buffer[] = []
          child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
          child.on('error', fail)
          child.on('close', (code) =>
            done({ code: code ?? 1, stdout: Buffer.concat(stdout).toString(), stderr: '', truncated: false }),
          )
        })
      },
    },
  } as unknown as Pick<CoreServices, 'tasks' | 'git'>
  return { services, commands }
}

const key = (path: string, line: number, text: string) => ({ taskId: 'task', path, line, revision: revisionOf(text) })

describe('line blame', () => {
  it('names the author and age of a committed line, with the commit in the detail', async () => {
    const root = repository()
    commit(root, 'a.ts', 'one\ntwo\n', 'Fix the <b>build</b> (#1234)\n\nLonger body.')
    const blame = createLineBlame(core(root).services, () => NOW)
    const [mark] = await blame([key('a.ts', 2, 'one\ntwo\n')], signal)
    expect(mark).toMatchObject({ severity: 'info', text: 'Ada *Lovelace*, 4 years ago' })
    expect(mark!.key).toEqual(key('a.ts', 2, 'one\ntwo\n'))
    const detail = mark!.detail!
    expect(detail.kind).toBe('markdown')
    // The name and email lose the characters that would add markup. The message goes as written.
    expect(detail.value.split('\n\n')[0]).toBe('**Ada Lovelace** <ada@example.com>')
    expect(detail.value).toContain('Fix the <b>build</b> (#1234)\n\nLonger body.')
    // The day depends on the Node's time zone.
    expect(detail.value).toMatch(/\n\n(18|19|20) Jul 2022 · #1234 · `[0-9a-f]{7}`$/)
  })

  it('says a changed line or an untracked file is not committed yet', async () => {
    const root = repository()
    commit(root, 'a.ts', 'one\ntwo\n', 'Start')
    writeFileSync(join(root, 'a.ts'), 'one\nchanged\n')
    writeFileSync(join(root, 'new.ts'), 'fresh\n')
    const blame = createLineBlame(core(root).services, () => NOW)
    const marks = await blame([key('a.ts', 2, 'one\nchanged\n'), key('new.ts', 1, 'fresh\n')], signal)
    expect(marks.map((mark) => mark.text)).toEqual(['You, not committed yet', 'You, not committed yet'])
    expect(marks.some((mark) => mark.detail)).toBe(false)
  })

  it('says every line of a repository with no commits is not committed yet', async () => {
    const root = repository()
    writeFileSync(join(root, 'a.ts'), 'one\n')
    git(root, 'add', 'a.ts')
    const [mark] = await createLineBlame(core(root).services)([key('a.ts', 1, 'one\n')], signal)
    expect(mark?.text).toBe('You, not committed yet')
  })

  it('answers nothing for another revision, or a file that changes while blame runs', async () => {
    const root = repository()
    commit(root, 'a.ts', 'one\n', 'Start')
    expect(await createLineBlame(core(root).services)([key('a.ts', 1, 'older\n')], signal)).toEqual([])
    const changing = core(root, (args) => {
      if (args[0] === 'blame') writeFileSync(join(root, 'a.ts'), 'edited\n')
    })
    expect(await createLineBlame(changing.services)([key('a.ts', 1, 'one\n')], signal)).toEqual([])
  })

  it('refuses a path outside the worktree, a bad line, an unknown task, and anything but a key', async () => {
    const root = repository()
    commit(root, 'a.ts', 'one\n', 'Start')
    writeFileSync(join(folder, 'outside.ts'), 'one\n')
    const { services, commands } = core(root)
    const marks = await createLineBlame(services)(
      [
        key('../outside.ts', 1, 'one\n'),
        key('/etc/hosts', 1, 'one\n'),
        key('a.ts', 1.5, 'one\n'),
        key('a.ts', 0, 'one\n'),
        { ...key('a.ts', 1, 'one\n'), taskId: 'other' },
        { ...key('a.ts', 1, 'one\n'), revision: 'not-a-hash' },
        'a.ts',
      ],
      signal,
    )
    expect(marks).toEqual([])
    expect(commands).toEqual([])
  })

  it('answers at most eight keys', async () => {
    const root = repository()
    commit(root, 'a.ts', 'one\n', 'Start')
    const marks = await createLineBlame(core(root).services)(Array(10).fill(key('a.ts', 1, 'one\n')), signal)
    expect(marks).toHaveLength(8)
  })

  it('reads a commit’s details once', async () => {
    const root = repository()
    commit(root, 'a.ts', 'one\ntwo\n', 'Start')
    const { services, commands } = core(root)
    const blame = createLineBlame(services)
    await blame([key('a.ts', 1, 'one\ntwo\n')], signal)
    await blame([key('a.ts', 2, 'one\ntwo\n')], signal)
    expect(commands.filter((args) => args[0] === 'blame')).toHaveLength(2)
    expect(commands.filter((args) => args[0] === 'log')).toHaveLength(1)
  })
})

describe('relativeAge', () => {
  it('uses the largest whole unit', () => {
    const day = 86_400_000
    expect(relativeAge(NOW - 4 * 365 * day, NOW)).toBe('4 years ago')
    expect(relativeAge(NOW - 3 * day, NOW)).toBe('3 days ago')
    expect(relativeAge(NOW - 90 * 60_000, NOW)).toBe('1 hour ago')
    expect(relativeAge(NOW - 5_000, NOW)).toBe('just now')
    expect(relativeAge(NOW + 5_000, NOW)).toBe('just now')
  })
})
