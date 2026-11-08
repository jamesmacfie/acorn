import { describe, expect, it } from 'vitest'
import { checkCloneUrl, cloneOutcome, type CloneRun } from './cloneRuns'

describe('cloneOutcome', () => {
  it('waits while the clone runs and answers its outcome', async () => {
    const waits: CloneRun[] = [
      { state: 'running', elapsedMs: 20_000 },
      { state: 'finished', result: { ok: true, projectId: 'p' } },
    ]
    expect(await cloneOutcome(async () => waits.shift()!)).toEqual({ ok: true, projectId: 'p' })
    expect(waits).toEqual([])
  })

  it('reports a clone the Node lost, such as after a restart, as failed', async () => {
    expect(await cloneOutcome(async () => ({ state: 'none' }))).toMatchObject({
      ok: false,
      error: expect.stringContaining('lost track'),
    })
  })
})

describe('checkCloneUrl', () => {
  it('allows https, ssh, and the scp form, and names the folder after the last path segment', () => {
    expect(checkCloneUrl('https://github.com/acme/web.git')).toEqual({ folder: 'web' })
    expect(checkCloneUrl('https://gitlab.example.com/group/sub/repo')).toEqual({ folder: 'repo' })
    expect(checkCloneUrl('https://jamie@bitbucket.org/acme/web.git')).toEqual({ folder: 'web' })
    expect(checkCloneUrl('ssh://git@github.com:22/acme/web.git')).toEqual({ folder: 'web' })
    expect(checkCloneUrl('ssh://github.com/acme/web/')).toEqual({ folder: 'web' })
    expect(checkCloneUrl('git@github.com:acme/web.git')).toEqual({ folder: 'web' })
  })

  it.each([
    ['http://github.com/acme/web.git', 'not http'],
    ['file:///tmp/x', 'not file'],
    ['git://github.com/acme/web.git', 'not git'],
    ['ext::sh -c touch% /tmp/pwned', 'spaces'],
    ['ext::sh%20-c%20id', 'user@host:path'],
    ['https://u:p@host/r', 'password or token'],
    ['-oProxyCommand=touch /tmp/pwned', 'spaces'],
    ['-oProxyCommand=id', 'user@host:path'],
    ['git@-oProxyCommand=id:acme/web', 'start with "-"'],
    ['-oProxyCommand=id@host:acme/web', 'start with "-"'],
    ['ssh://-oProxyCommand=id/acme/web', 'start with "-"'],
    ['git@github.com:-upload-pack=id', 'start with "-"'],
    ['https://github.com/acme/web\n', 'control characters'],
    ['C:\\repos\\web', 'user@host:path'],
    ['https://github.com/acme/web.git?x=1', 'query or fragment'],
    ['https://github.com/', 'repository folder'],
    ['https://github.com/acme/..', 'repository folder'],
  ])('refuses %s', (url, reason) => {
    const checked = checkCloneUrl(url)
    expect('error' in checked && checked.error).toContain(reason)
  })
})
