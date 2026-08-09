import { describe, expect, it } from 'vitest'
import type { NodePluginPermissions } from '@acorn/protocol/api.ts'
import { keyClaimGrants, keyClaimPermissionLines, nodePermissionLines, uiPermissionLines, webviewPermissionLines } from './permissions'

// The permission DIFF the update prompt shows is set-difference over these strings, so the wording is
// the diff key: a rephrasing that keeps the same grant would light every line up as "new". That makes
// this a contract test, not a snapshot of prose.

const permissions = (over: Partial<NodePluginPermissions> = {}): NodePluginPermissions => ({
  api: [],
  events: [],
  node: { core: [], capabilities: [], secrets: false, exec: false, net: [] },
  ...over,
})

const added = (before: NodePluginPermissions, after: NodePluginPermissions, project: (p: NodePluginPermissions) => string[]) => {
  const had = new Set(project(before))
  return project(after).filter((line) => !had.has(line))
}

describe('the two permission groups', () => {
  it('keeps node reach and UI scopes apart, because only one of them is enforced', () => {
    const all = permissions({
      api: ['core.tasks:read'],
      events: ['runtime:task-archived'],
      node: { core: ['issues'], capabilities: ['docker.compose'], secrets: true, exec: true, net: ['ntfy.sh'] },
    })
    expect(nodePermissionLines(all)).toEqual([
      'Use your saved credentials to make requests on its behalf',
      'Run commands on the node',
      'Reach ntfy.sh',
      'Use capability docker.compose',
      '1 node permission request this version of acorn does not recognise (ignored)',
    ])
    expect(uiPermissionLines(all)).toEqual(['Read tasks', 'Receive task archive events'])
  })

  it('names the disclosure hiding inside core.projects', () => {
    // "Read projects" does not sound like "list every codebase on this machine and where it lives", but
    // that is what checkouts() returns (docs/security.md § Rung 1).
    expect(nodePermissionLines(permissions({ node: { core: ['projects:read'], capabilities: [], secrets: false, exec: false, net: [] } }))).toEqual([
      'Read projects, including where every codebase lives on disk',
    ])
  })

  it('names the executable configuration carried by the config grant', () => {
    expect(nodePermissionLines(permissions({ node: { core: ['projects:config'], capabilities: [], secrets: false, exec: false, net: [] } }))).toEqual([
      'Read every project’s build, dev and database scripts',
    ])
  })

  it('never echoes unknown manifest copy as an enforced grant', () => {
    const lines = uiPermissionLines(permissions({
      api: ['core.tasks:read', 'read-only access to nothing'],
      events: ['none-this-plugin-does-not-use-events'],
    }))
    expect(lines).toEqual(['Read tasks', '2 requests this version of acorn does not recognise (ignored)'])
    expect(lines.join(' ')).not.toContain('read-only access to nothing')
    expect(lines.join(' ')).not.toContain('none-this-plugin')
  })

  it('renders no grant sentence when every UI request is unknown', () => {
    expect(uiPermissionLines(permissions({ api: ['core.quantum:read'], events: ['runtime:quantum-shift'] }))).toEqual([
      '2 requests this version of acorn does not recognise (ignored)',
    ])
  })

  it('says nothing for a plugin that declared nothing', () => {
    expect(nodePermissionLines(permissions())).toEqual([])
    expect(uiPermissionLines(permissions())).toEqual([])
  })
})

describe('the update diff', () => {
  it('marks only what is new, so an unchanged set reads as unchanged', () => {
    const before = permissions({ api: ['core.tasks:read'], node: { core: ['issues'], capabilities: [], secrets: false, exec: false, net: [] } })
    const after = permissions({
      api: ['core.tasks:read', 'core.tasks:write'],
      node: { core: ['issues'], capabilities: [], secrets: false, exec: true, net: [] },
    })
    expect(added(before, after, nodePermissionLines)).toEqual(['Run commands on the node'])
    expect(added(before, after, uiPermissionLines)).toEqual(['Create and update tasks'])
  })

  it('marks nothing when only the version moved', () => {
    const same = permissions({ api: ['core.tasks:read'], events: ['runtime:task-archived'] })
    expect(added(same, same, nodePermissionLines)).toEqual([])
    expect(added(same, same, uiPermissionLines)).toEqual([])
  })

  // A permission the plugin gave UP is not marked, on purpose: the prompt asks "is this new reach
  // acceptable", and a removal is never the thing to hesitate over.
  it('does not mark a permission that was dropped', () => {
    const before = permissions({ node: { core: [], capabilities: [], secrets: true, exec: false, net: [] } })
    expect(added(before, permissions(), nodePermissionLines)).toEqual([])
  })
})

describe('webview grants', () => {
  it('renders web pages as their own host-naming permission group', () => {
    expect(webviewPermissionLines([{ surface: 'docs', label: 'Docs', hosts: ['docs.example.com', '*.example.com'] }])).toEqual([
      'Show web pages from *.example.com, docs.example.com in the "Docs" pane',
    ])
    expect(webviewPermissionLines([])).toEqual([])
  })

  it('treats host widening as new and ignores reordering', () => {
    const before = [{ surface: 'docs', label: 'Docs', hosts: ['docs.example.com', 'api.example.com'] }]
    const reordered = [{ surface: 'docs', label: 'Docs', hosts: ['api.example.com', 'docs.example.com'] }]
    const widened = [{ surface: 'docs', label: 'Docs', hosts: ['*.example.com', 'docs.example.com'] }]
    const had = new Set(webviewPermissionLines(before))
    expect(webviewPermissionLines(reordered).filter((line) => !had.has(line))).toEqual([])
    expect(webviewPermissionLines(widened).filter((line) => !had.has(line))).toEqual([
      'Show web pages from *.example.com, docs.example.com in the "Docs" pane',
    ])
  })
})

describe('frame key claims', () => {
  it('shows only host-recognized claims and names their surface', () => {
    const grants = keyClaimGrants({
      frames: [{
        target: 'pane', id: 'editor', label: 'Editor', glyph: 'puzzle', order: 1, formFactor: ['desktop'],
        claimsKeys: ['meta+f', 'meta+k', 'not a chord'],
      }],
    })
    expect(grants).toEqual([{ surface: 'editor', label: 'Editor', chords: ['meta+f'] }])
    expect(keyClaimPermissionLines(grants)).toEqual(['Handle ⌘F in the "Editor" surface'])
  })
})
