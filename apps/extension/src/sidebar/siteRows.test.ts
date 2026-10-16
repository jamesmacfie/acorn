import { describe, expect, it } from 'vitest'
import type { BridgeHandoff, BridgeTaskPage } from '@acorn/protocol/extensionBridge.ts'
import { siteRows } from './siteRows'

const handoff = (pluginId: string, match: string[], anchors: string[] = []): BridgeHandoff => ({
  id: 'h',
  label: 'Open in Acorn',
  pluginId,
  match,
  anchors,
})
const runn: BridgeTaskPage = {
  origin: 'http://billing-7f3a.runn.localhost:3000',
  pathPrefix: '/',
  source: 'runn',
  status: { label: 'Runn stack', state: 'running', tone: 'ok' },
}
const projects = [
  { id: 'p1', name: 'web-app' },
  { id: 'p2', name: 'billing-api' },
]

describe('siteRows', () => {
  it('lists each site once by the access it needs, with every use, in the order the lists come', () => {
    const rows = siteRows({
      handoffs: [
        handoff('github', ['https://github.com/{owner}/{repo}/pull/{number}'], ['.actions']),
        handoff('linear', ['https://linear.app/{team}/issue/{key}']),
      ],
      sites: [
        { projectId: 'p1', origin: 'https://app.acme.test', pathPrefix: '/invoices' },
        { projectId: 'p2', domain: 'acme.test' },
        { projectId: 'p2', origin: 'https://app.acme.test', pathPrefix: '/billing' },
        { projectId: 'p1', regex: '^https://acme\\.test/' },
      ],
      apps: [runn],
      projects,
    })
    expect(rows.map(({ key, host, uses, pluginId }) => ({ key, host, uses, pluginId }))).toEqual([
      { key: 'https://github.com/*', host: 'github.com', uses: ['Task chips on its pages'], pluginId: 'github' },
      { key: 'https://linear.app/*', host: 'linear.app', uses: ['Look up items'], pluginId: 'linear' },
      // Two projects on one host share its row, and its menu holds both.
      {
        key: 'https://app.acme.test/*',
        host: 'app.acme.test',
        uses: ['Suggests web-app', 'Suggests billing-api'],
        pluginId: null,
      },
      { key: 'https://*.acme.test/*', host: '*.acme.test', uses: ['Suggests billing-api'], pluginId: null },
      // A regex names no host, so it has a row of its own with no access to switch.
      { key: '^https://acme\\.test/', host: '^https://acme\\.test/', uses: ['Suggests web-app'], pluginId: null },
      // Browsers grant access by host, so the app's port goes.
      {
        key: 'http://billing-7f3a.runn.localhost/*',
        host: 'http://billing-7f3a.runn.localhost',
        uses: ['Branch marker for Runn stack'],
        pluginId: 'runn',
      },
    ])
    expect(rows[2]!.associations).toHaveLength(2)
    expect(rows[4]!.pattern).toBeNull()
  })

  it('says a use once, and names a project the Node has not listed yet', () => {
    const rows = siteRows({
      handoffs: [
        handoff('github', ['https://github.com/{o}/{r}/pull/{n}', 'https://github.com/{o}/{r}/pull/{n}/{tab}']),
      ],
      sites: [
        { projectId: 'p9', origin: 'https://github.com', pathPrefix: '/acme' },
        { projectId: 'p9', exact: 'https://github.com/acme/web' },
      ],
      apps: [],
      projects,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.uses).toEqual(['Look up items', 'Suggests a project'])
    expect(rows[0]!.associations).toHaveLength(2)
  })
})
