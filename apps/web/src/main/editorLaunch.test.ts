import { describe, expect, it } from 'vitest'
import { buildEditorArgv, classifyEditorCommand } from './editorLaunch'

const opts = (existing: string[]) => ({
  pathVar: '/usr/local/bin:/usr/bin',
  exists: (p: string) => existing.includes(p),
})

describe('classifyEditorCommand', () => {
  it('resolves a bare word on PATH', () => {
    expect(classifyEditorCommand('code', opts(['/usr/local/bin/code']))).toEqual({ ok: true, file: '/usr/local/bin/code', args: [] })
  })

  it('prefers the first PATH dir containing the binary', () => {
    expect(classifyEditorCommand('code', opts(['/usr/local/bin/code', '/usr/bin/code']))).toEqual({ ok: true, file: '/usr/local/bin/code', args: [] })
  })

  it('splits a compound command into argv', () => {
    expect(classifyEditorCommand('cursor -n --wait', opts(['/usr/bin/cursor']))).toEqual({ ok: true, file: '/usr/bin/cursor', args: ['-n', '--wait'] })
  })

  it('execs an absolute path directly', () => {
    expect(classifyEditorCommand('/opt/zed/zed --foreground', opts(['/opt/zed/zed']))).toEqual({ ok: true, file: '/opt/zed/zed', args: ['--foreground'] })
  })

  it('reports a clean reason for missing binaries', () => {
    expect(classifyEditorCommand('nope', opts([]))).toEqual({ ok: false, reason: "'nope' is not on PATH." })
    expect(classifyEditorCommand('/opt/gone', opts([]))).toEqual({ ok: false, reason: 'Editor not found at /opt/gone.' })
  })

  it('rejects blank input and relative paths', () => {
    expect(classifyEditorCommand('   ', opts([])).ok).toBe(false)
    expect(classifyEditorCommand('../evil', opts(['../evil'])).ok).toBe(false)
  })
})

describe('buildEditorArgv', () => {
  it('appends the target dir and honours repo → default → code precedence', () => {
    const o = opts(['/usr/bin/zed', '/usr/bin/code', '/usr/bin/cursor'])
    expect(buildEditorArgv('zed', 'cursor -n', '/wt', o)).toEqual({ ok: true, file: '/usr/bin/zed', args: ['/wt'] })
    expect(buildEditorArgv(null, 'cursor -n', '/wt', o)).toEqual({ ok: true, file: '/usr/bin/cursor', args: ['-n', '/wt'] })
    expect(buildEditorArgv(null, null, '/wt', o)).toEqual({ ok: true, file: '/usr/bin/code', args: ['/wt'] })
  })
  it('propagates a clean failure', () => {
    expect(buildEditorArgv('nope', null, '/wt', opts([]))).toEqual({ ok: false, reason: "'nope' is not on PATH." })
  })
})
