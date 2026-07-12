import { describe, expect, it } from 'vitest'
import {
  buildSessionEnv,
  childEnv,
  clampDim,
  computeIdle,
  isContainedPath,
  isDirty,
  isValidRepoIdent,
  matchBlockedPrompt,
  parseTmuxSessions,
  resolveBackend,
  RING_CAP,
  tmuxAttachArgs,
  tmuxName,
  tmuxNewSessionArgs,
  trimRing,
  worktreeDirName,
} from './terminalUtils'

describe('clampDim', () => {
  it('keeps sane integers and rejects junk to the fallback', () => {
    expect(clampDim(120, 80)).toBe(120)
    expect(clampDim(0, 80)).toBe(80)
    expect(clampDim(99999, 24)).toBe(24)
    expect(clampDim(40.5, 24)).toBe(24)
    expect(clampDim('80', 24)).toBe(24)
    expect(clampDim(undefined, 24)).toBe(24)
  })
})

describe('trimRing', () => {
  it('caps the buffer at RING_CAP, keeping the most recent bytes', () => {
    const big = 'a'.repeat(RING_CAP) + 'TAIL'
    const out = trimRing(big)
    expect(out.length).toBe(RING_CAP)
    expect(out.endsWith('TAIL')).toBe(true)
    expect(trimRing('short')).toBe('short')
  })
})

describe('resolveBackend', () => {
  it('uses tmux only when preferred and available, else degrades to node-pty', () => {
    expect(resolveBackend('tmux', true)).toBe('tmux')
    expect(resolveBackend('tmux', false)).toBe('node-pty')
    expect(resolveBackend('node-pty', true)).toBe('node-pty')
  })
})

describe('parseTmuxSessions', () => {
  it('keeps only acorn-prefixed session names', () => {
    const out = 'acorn-abc\nmy-other-session\nacorn-def\n\n'
    expect(parseTmuxSessions(out)).toEqual(new Set(['acorn-abc', 'acorn-def']))
  })
})

describe('tmux arg builders', () => {
  it('build create-or-noop + attach argv', () => {
    expect(tmuxName('abc')).toBe('acorn-abc')
    expect(tmuxNewSessionArgs('acorn-abc', '/repo', 'claude')).toEqual(['new-session', '-A', '-d', '-s', 'acorn-abc', '-c', '/repo', 'claude'])
    // env is set explicitly via -e so a pre-existing tmux server can't drop ACORN_* (no-tools bug)
    expect(tmuxNewSessionArgs('acorn-abc', '/repo', 'claude', { ACORN_TASK_ID: 't1', ACORN_API_TOKEN: 'tok' })).toEqual([
      'new-session', '-A', '-d', '-e', 'ACORN_TASK_ID=t1', '-e', 'ACORN_API_TOKEN=tok', '-s', 'acorn-abc', '-c', '/repo', 'claude',
    ])
    expect(tmuxAttachArgs('acorn-abc')).toEqual(['attach', '-t', 'acorn-abc'])
  })
})

describe('computeIdle', () => {
  const now = 1_000_000
  it('flags only running agents past the silence threshold', () => {
    expect(computeIdle('agent', 'running', now - 20_000, now, 10_000)).toBe(true)
    expect(computeIdle('agent', 'running', now - 5_000, now, 10_000)).toBe(false)
  })
  it('never flags shells or exited sessions', () => {
    expect(computeIdle('shell', 'running', now - 20_000, now, 10_000)).toBe(false)
    expect(computeIdle('agent', 'exited', now - 20_000, now, 10_000)).toBe(false)
  })
})

describe('worktrees', () => {
  it('builds the per-PR dir name', () => {
    expect(worktreeDirName('acme', 'widget', 42)).toBe('acme-widget-pr-42')
  })
  it('treats any porcelain output as dirty', () => {
    expect(isDirty('')).toBe(false)
    expect(isDirty('\n  \n')).toBe(false)
    expect(isDirty(' M src/a.ts\n?? b.ts')).toBe(true)
  })
})

describe('path-traversal guards', () => {
  it('isValidRepoIdent rejects traversal and separators', () => {
    expect(isValidRepoIdent('acme')).toBe(true)
    expect(isValidRepoIdent('my.repo_2-x')).toBe(true)
    expect(isValidRepoIdent('..')).toBe(false)
    expect(isValidRepoIdent('.hidden')).toBe(false)
    expect(isValidRepoIdent('a/b')).toBe(false)
    expect(isValidRepoIdent('../../etc')).toBe(false)
    expect(isValidRepoIdent('')).toBe(false)
  })
  it('isContainedPath rejects escapes from the root', () => {
    expect(isContainedPath('/data/worktrees', '/data/worktrees/acme-w-pr-1')).toBe(true)
    expect(isContainedPath('/data/worktrees', '/data/worktrees')).toBe(true)
    expect(isContainedPath('/data/worktrees', '/data/worktrees/../../etc/passwd')).toBe(false)
    expect(isContainedPath('/data/worktrees', '/data/worktrees-evil')).toBe(false)
    expect(isContainedPath('/data/worktrees', '/etc/passwd')).toBe(false)
  })
})

describe('matchBlockedPrompt (docs/terminal-and-agents.md)', () => {
  it.each([
    ['Do you want to proceed? (y/n)', true],
    ['Overwrite existing file? [Y/n]', true],
    ['Press enter to continue', true],
    ['Which file should I edit?', true], // trailing ? on the last line
    ['done.\nAll tests passed.', false],
    ['building…\ncompiling module 4 of 7', false],
  ])('%j → %s', (tail, expected) => {
    expect(matchBlockedPrompt(tail)).toBe(expected)
  })

  it('ignores a mid-stream question that is not the last line', () => {
    expect(matchBlockedPrompt('What changed?\nApplying edits now\nDone.')).toBe(false)
  })

  it('is not fooled by spinner frames or ANSI colour', () => {
    expect(matchBlockedPrompt('⠋ working…\n⠙ still working…')).toBe(false)
    expect(matchBlockedPrompt('\x1b[32m✓ built\x1b[0m\n\x1b[90mwaiting for changes\x1b[0m')).toBe(false)
    expect(matchBlockedPrompt('\x1b[1mProceed?\x1b[0m (y/n)\x1b[?25l')).toBe(true)
  })

  it('handles carriage-return-only spinners (last visual line wins)', () => {
    expect(matchBlockedPrompt('step 1\rstep 2\rstep 3 running')).toBe(false)
    expect(matchBlockedPrompt('')).toBe(false)
  })
})

describe('buildSessionEnv', () => {
  const baseEnv = { HOME: '/Users/x', PATH: '/usr/bin', SESSION_ENC_KEY: 'super-secret', GITHUB_CLIENT_SECRET: 'also-secret' }
  const task = { repoOwner: 'acme', repoName: 'widget', branch: 'feat/login', title: 'Fix login' }

  it('injects all six ACORN_* vars for a task with a resolved worktree', () => {
    const env = buildSessionEnv({ taskId: 't1', cwd: '/wt/acme-widget-feat-login', task, baseEnv })
    expect(env.ACORN_TASK_ID).toBe('t1')
    expect(env.ACORN_WORKTREE_PATH).toBe('/wt/acme-widget-feat-login')
    expect(env.ACORN_REPO).toBe('acme/widget')
    expect(env.ACORN_BRANCH).toBe('feat/login')
    expect(env.ACORN_TASK_SLUG).toBe('feat-login')
    expect(env.ACORN_TASK_TITLE).toBe('Fix login')
  })

  it('omits task-derived vars when the task row is missing', () => {
    const env = buildSessionEnv({ taskId: 't1', cwd: '/home/x', task: null, baseEnv })
    expect(env.ACORN_TASK_ID).toBe('t1')
    expect(env.ACORN_WORKTREE_PATH).toBe('/home/x')
    expect(env.ACORN_REPO).toBeUndefined()
    expect(env.ACORN_BRANCH).toBeUndefined()
    expect(env.ACORN_TASK_SLUG).toBeUndefined()
    expect(env.ACORN_TASK_TITLE).toBeUndefined()
  })

  it('lets caller-supplied env overrides win', () => {
    const env = buildSessionEnv({ taskId: 't1', cwd: '/wt', task, env: { ACORN_TASK_TITLE: 'Override', EXTRA: '1' }, baseEnv })
    expect(env.ACORN_TASK_TITLE).toBe('Override')
    expect(env.EXTRA).toBe('1')
  })

  it('preserves the childEnv whitelist — no secret leakage', () => {
    const env = buildSessionEnv({ taskId: 't1', cwd: '/wt', task, baseEnv })
    expect(env.HOME).toBe('/Users/x')
    expect(env.PATH).toBe('/usr/bin')
    expect(env.TERM).toBe('xterm-256color')
    expect(env.SESSION_ENC_KEY).toBeUndefined()
    expect(env.GITHUB_CLIENT_SECRET).toBeUndefined()
  })
})

describe('childEnv', () => {
  it('never leaks secrets and always sets TERM', () => {
    const env = childEnv({
      HOME: '/Users/x',
      PATH: '/usr/bin',
      SESSION_ENC_KEY: 'super-secret',
      GITHUB_CLIENT_SECRET: 'also-secret',
      RANDOM_OTHER: 'nope',
    })
    expect(env.HOME).toBe('/Users/x')
    expect(env.PATH).toBe('/usr/bin')
    expect(env.TERM).toBe('xterm-256color')
    expect(env.SESSION_ENC_KEY).toBeUndefined()
    expect(env.GITHUB_CLIENT_SECRET).toBeUndefined()
    expect(env.RANDOM_OTHER).toBeUndefined()
  })
})
