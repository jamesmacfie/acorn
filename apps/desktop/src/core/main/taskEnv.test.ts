import { describe, expect, it } from 'vitest'
import { buildSessionEnv, childEnv } from './taskEnv'

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
  it('advertises truecolor — agent TUIs downgrade to 256 colours without it', () => {
    expect(childEnv({}).COLORTERM).toBe('truecolor')
  })

  it('guarantees a UTF-8 locale for Finder-launched processes with no locale environment', () => {
    expect(childEnv({}).LANG).toBe('en_US.UTF-8')
  })

  it('preserves LC_CTYPE and does not override an existing locale', () => {
    const env = childEnv({ LC_CTYPE: 'de_DE.UTF-8' })
    expect(env.LC_CTYPE).toBe('de_DE.UTF-8')
    expect(env.LANG).toBeUndefined()
  })

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
