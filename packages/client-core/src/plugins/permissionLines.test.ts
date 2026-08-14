import { describe, expect, it } from 'vitest'
import type { NodePluginPermissions } from '@acorn/protocol/api.ts'
import { keyClaimGrants, keyClaimPermissionLines, nodePermissionLines, type PermissionLine, uiPermissionLines, webviewPermissionLines } from './permissions'

// The permission DIFF the update prompt shows is a set-difference over the grant KEYS, so the wording
// is free to change and the identifier is what has to stay stable. That makes this a contract test on
// the keys, and a readability check on the sentences.

const texts = (lines: readonly PermissionLine[]): string[] => lines.map((line) => line.text)

const permissions = (over: Partial<NodePluginPermissions> = {}): NodePluginPermissions => ({
  api: [],
  events: [],
  node: { core: [], capabilities: [], secrets: false, exec: false, net: [] },
  ...over,
})

const added = (before: NodePluginPermissions, after: NodePluginPermissions, project: (p: NodePluginPermissions) => PermissionLine[]) => {
  const had = new Set(project(before).map((line) => line.key))
  return texts(project(after).filter((line) => !had.has(line.key)))
}

describe('the two permission groups', () => {
  it('keeps node reach and UI scopes apart, because only one of them is enforced', () => {
    const all = permissions({
      api: ['core.tasks:read'],
      events: ['runtime:task-archived'],
      node: { core: ['issues'], capabilities: ['docker.compose'], secrets: true, exec: true, net: ['ntfy.sh'] },
    })
    expect(texts(nodePermissionLines(all))).toEqual([
      'Use your saved credentials to make requests on its behalf',
      'Run commands on the node',
      'Reach ntfy.sh',
      'Use capability docker.compose',
      '1 node permission request this version of acorn does not recognise (ignored)',
    ])
    expect(texts(uiPermissionLines(all))).toEqual(['Read tasks', 'Receive task archive events'])
  })

  it('names the disclosure hiding inside core.projects', () => {
    // "Read projects" does not sound like "list every codebase on this machine and where it lives", but
    // that is what checkouts() returns (docs/security.md § Rung 1).
    expect(texts(nodePermissionLines(permissions({ node: { core: ['projects:read'], capabilities: [], secrets: false, exec: false, net: [] } })))).toEqual([
      'Read projects, including where every codebase lives on disk',
    ])
  })

  it('names the executable configuration carried by the config grant', () => {
    expect(texts(nodePermissionLines(permissions({ node: { core: ['projects:config'], capabilities: [], secrets: false, exec: false, net: [] } })))).toEqual([
      'Read every project’s build, dev and database scripts',
    ])
  })

  it('never echoes unknown manifest copy as an enforced grant', () => {
    const lines = texts(uiPermissionLines(permissions({
      api: ['core.tasks:read', 'read-only access to nothing'],
      events: ['none-this-plugin-does-not-use-events'],
    })))
    expect(lines).toEqual(['Read tasks', '2 requests this version of acorn does not recognise (ignored)'])
    expect(lines.join(' ')).not.toContain('read-only access to nothing')
    expect(lines.join(' ')).not.toContain('none-this-plugin')
  })

  it('renders no grant sentence when every UI request is unknown', () => {
    expect(texts(uiPermissionLines(permissions({ api: ['core.quantum:read'], events: ['runtime:quantum-shift'] })))).toEqual([
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

  it('marks nothing when only the WORDING moved', () => {
    // The one this whole record shape exists for. Editing the trust prompt's copy used to re-prompt
    // every owner of every installed plugin with the reworded line highlighted as newly requested,
    // because the sentence was the diff key. Same grants, different sentence, nothing new.
    const same = permissions({
      api: ['core.tasks:read'],
      node: { core: ['fs'], capabilities: [], secrets: true, exec: false, net: ['ntfy.sh'] },
    })
    const reworded = (project: (p: NodePluginPermissions) => PermissionLine[]) => (p: NodePluginPermissions) =>
      project(p).map((line) => ({ ...line, text: `SEE: ${line.text}` }))
    expect(added(same, same, reworded(nodePermissionLines))).toEqual([])
    expect(added(same, same, reworded(uiPermissionLines))).toEqual([])
  })

  it('marks a growing set of unrecognised requests as new', () => {
    // The count is in the key on purpose. An update asking for three things this shell cannot name
    // where it previously asked for one HAS grown its reach — and it is the growth an owner can
    // reason about least, so it is the last thing that should diff as unchanged.
    const before = permissions({ api: ['core.quantum:read'] })
    const after = permissions({ api: ['core.quantum:read', 'core.warp:write', 'core.flux:read'] })
    expect(added(before, after, uiPermissionLines)).toEqual([
      '3 requests this version of acorn does not recognise (ignored)',
    ])
    // Unchanged stays unchanged: the same count is the same line.
    expect(added(before, before, uiPermissionLines)).toEqual([])
  })

  it('carries severity with the grant instead of guessing it from the sentence', () => {
    // The other half. A high-risk grant used to be recognised by prefix-matching its copy against a
    // twenty-entry table, so a new one whose sentence matched nothing rendered as boring as a toast.
    const risky = permissions({
      api: ['core.projects:read'],
      node: { core: ['fs', 'projects:write'], capabilities: [], secrets: true, exec: true, net: ['ntfy.sh'] },
    })
    const high = (lines: readonly PermissionLine[]) => lines.filter((line) => line.high).map((line) => line.key)
    expect(high(nodePermissionLines(risky))).toEqual(['node.secrets', 'node.exec', 'node.core:projects:write'])
    expect(high(uiPermissionLines(risky))).toEqual(['core.projects:read'])
    // And every line carries an icon, so nothing falls through to a generic default.
    expect([...nodePermissionLines(risky), ...uiPermissionLines(risky)].every((line) => line.icon.length > 0)).toBe(true)
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
    expect(texts(webviewPermissionLines([{ surface: 'docs', label: 'Docs', hosts: ['docs.example.com', '*.example.com'] }]))).toEqual([
      'Show web pages from *.example.com, docs.example.com in the "Docs" pane',
    ])
    expect(webviewPermissionLines([])).toEqual([])
  })

  it('treats host widening as new and ignores reordering', () => {
    const before = [{ surface: 'docs', label: 'Docs', hosts: ['docs.example.com', 'api.example.com'] }]
    const reordered = [{ surface: 'docs', label: 'Docs', hosts: ['api.example.com', 'docs.example.com'] }]
    const widened = [{ surface: 'docs', label: 'Docs', hosts: ['*.example.com', 'docs.example.com'] }]
    const had = new Set(webviewPermissionLines(before).map((line) => line.key))
    expect(webviewPermissionLines(reordered).filter((line) => !had.has(line.key))).toEqual([])
    expect(texts(webviewPermissionLines(widened).filter((line) => !had.has(line.key)))).toEqual([
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
    expect(texts(keyClaimPermissionLines(grants))).toEqual(['Handle ⌘F in the "Editor" surface'])
  })
})
