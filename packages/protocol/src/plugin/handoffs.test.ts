import { describe, expect, it } from 'vitest'
import { browserHandoffResolution, browserPanelView, taskAddressList } from './handoffs.ts'

const address = (origin: string) => ({
  addresses: [{ taskId: 't1', origin, label: 'Runn stack', state: 'running', severity: 'info' }],
})
const accepts = (origin: string) => taskAddressList.safeParse(address(origin)).success

describe('task addresses', () => {
  it('takes an exact origin on a loopback host, port included', () => {
    expect(accepts('https://runn-05ea41.runn.localhost:5104')).toBe(true)
    expect(accepts('http://localhost:5173')).toBe(true)
    expect(accepts('http://127.0.0.1:3000')).toBe(true)
    expect(accepts('http://[::1]:8080')).toBe(true)
  })

  it("refuses another site's host, so a plugin can't tie its pages to a task", () => {
    expect(accepts('https://github.com')).toBe(false)
    expect(accepts('https://localhost.example.com')).toBe(false)
    expect(accepts('http://127.0.0.1.example.com')).toBe(false)
  })

  it('refuses a path, a spelling a browser would not report, and other schemes', () => {
    expect(accepts('https://app.localhost:5104/admin')).toBe(false)
    expect(accepts('https://app.localhost:5104/')).toBe(false)
    expect(accepts('https://app.localhost:443')).toBe(false)
    expect(accepts('ftp://localhost:21')).toBe(false)
  })
})

describe('browser panel views', () => {
  const logs = (lines: string[]) => ({
    kind: 'logs',
    title: 'Logs',
    sources: [{ id: 'web.1', label: 'web' }],
    source: 'web.1',
    lines,
  })
  const accepts = (...blocks: unknown[]) => browserPanelView.safeParse({ blocks }).success

  it('takes every block kind', () => {
    expect(
      accepts(
        { kind: 'status', label: 'Stack', state: 'running', severity: 'info', detail: 'Up 3 minutes' },
        { kind: 'links', title: 'Links', links: [{ label: 'Database', url: 'postgres://localhost:5432/app' }] },
        { kind: 'rows', title: 'Services', rows: [{ label: 'web', state: 'healthy', severity: 'info' }] },
        logs(['ready', '']),
        { ...logs([]), sources: [], source: null },
      ),
    ).toBe(true)
  })

  it('refuses a kind this build does not know, or a field it does not', () => {
    expect(accepts({ kind: 'chart', title: 'CPU' })).toBe(false)
    expect(accepts({ kind: 'status', label: 'Stack', state: 'up', severity: 'info', html: '<b>' })).toBe(false)
    expect(accepts({ kind: 'status', label: 'Stack', state: 'up', severity: 'ok' })).toBe(false)
  })

  it('refuses too many log lines, an overlong line, and a source ID outside the grammar', () => {
    expect(accepts(logs(Array.from({ length: 200 }, () => 'x'.repeat(1_000))))).toBe(true)
    expect(accepts(logs(Array.from({ length: 201 }, () => 'x')))).toBe(false)
    expect(accepts(logs(['x'.repeat(1_001)]))).toBe(false)
    expect(accepts({ ...logs([]), source: '../web' })).toBe(false)
  })
})

describe('browser handoff seeds', () => {
  const accepts = (changeRequest: Record<string, unknown>) =>
    browserHandoffResolution.safeParse({
      items: [
        {
          identifier: 'acme/api#7',
          url: 'https://bitbucket.org/acme/api/pull-requests/7',
          title: 'Fix',
          connection: { id: 'c1', label: 'Bitbucket' },
          projects: ['p1'],
          seed: { origin: 'bitbucket', changeRequest },
        },
      ],
    }).success

  it("takes a fork's source branch and path, and refuses ones git could misread", () => {
    expect(accepts({ number: 7, sourceBranch: 'fix', sourceRepository: 'Alice/API' })).toBe(true)
    expect(accepts({ number: 7, sourceRepository: '-alice/api' })).toBe(false)
    expect(accepts({ number: 7, sourceRepository: 'alice/..' })).toBe(false)
    expect(accepts({ number: 7, sourceBranch: '--upload-pack=x' })).toBe(false)
  })
})
