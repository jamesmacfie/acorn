import { describe, expect, it } from 'vitest'
import type { NodePluginPermissions } from '@acorn/protocol/api.ts'
import { extensionPermissionLine, harnessGrants, harnessPermissionLines, keyClaimGrants, keyClaimPermissionLines, nodePermissionLines, type PermissionLine, uiPermissionLines, webviewPermissionLines } from './permissions'
import { EXTENSION_POINT_KINDS, HOOK_MODES } from '@acorn/protocol/extensionPoints.ts'

// The update prompt diffs grant keys, not wording, so the key is what has to stay stable. This is a
// contract test on the keys and a readability check on the sentences.

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

  it('names inherited environment and local-file grants as high risk', () => {
    const lines = nodePermissionLines(permissions({
      node: {
        core: [],
        capabilities: [],
        secrets: false,
        exec: false,
        net: [],
        env: ['DATABASE_URL'],
        files: [{ env: 'ACORN_NODES_FILE', access: 'read-write' }],
      },
    }))
    expect(texts(lines)).toEqual([
      'Read the node environment value DATABASE_URL',
      'Read and write the local file configured by ACORN_NODES_FILE',
    ])
    expect(lines.every((entry) => entry.high)).toBe(true)
  })

  it('names what a telemetry sink can see, because it is every owner and not just this plugin', () => {
    // The one read-everything grant on `ctx.core`. Writing telemetry gets no line at all: it needs
    // no token, because a plugin measuring its own work reads nobody else's
    // (docs/security.md § Telemetry sinks).
    const lines = nodePermissionLines(permissions({ node: { core: ['telemetry'], capabilities: [], secrets: false, exec: false, net: [] } }))
    expect(texts(lines)).toEqual([
      'Read this node’s telemetry: request timings, schedule and hook runs, logs, and error names from every plugin',
    ])
    expect(lines.every((line) => line.high)).toBe(true)
  })

  it('names the executable configuration carried by the config grant', () => {
    expect(texts(nodePermissionLines(permissions({ node: { core: ['projects:config'], capabilities: [], secrets: false, exec: false, net: [] } })))).toEqual([
      'Read every project’s build, dev and database scripts',
    ])
  })

  it('discloses a plugin\'s own live channel without echoing the verb it named', () => {
    // Core cannot enumerate a plugin's verbs, so the channel is admitted by shape
    // (frames/channels.ts). The sentence stays the host's, because a verb is manifest copy.
    const lines = texts(uiPermissionLines(permissions({ events: ['plugin:machine-stats:sample'] })))
    expect(lines).toEqual(['Receive live updates from its own node half'])
    expect(lines.join(' ')).not.toContain('sample')
  })

  it('ignores a channel dressed up as another plugin\'s namespace, and a malformed one', () => {
    // frameServices.ts refuses another plugin's channel at subscribe time, so a prompt line for one is
    // honest about what was asked for. A malformed name must not reach the prompt as a grant.
    expect(texts(uiPermissionLines(permissions({ events: ['plugin:Other:sample', 'plugin:a:b:c'] })))).toEqual([
      '2 requests this version of acorn does not recognise (ignored)',
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

  it('marks nothing when only the wording moved', () => {
    // The case this record shape exists for. With the sentence as the diff key, a copy edit re-prompted
    // every owner of every installed plugin. Same grants, different sentence, nothing new.
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
    // The count is in the key on purpose. One unrecognised request becoming three is a widening, and
    // it is the widening an owner can reason about least, so it must not diff as unchanged.
    const before = permissions({ api: ['core.quantum:read'] })
    const after = permissions({ api: ['core.quantum:read', 'core.warp:write', 'core.flux:read'] })
    expect(added(before, after, uiPermissionLines)).toEqual([
      '3 requests this version of acorn does not recognise (ignored)',
    ])
    // Unchanged stays unchanged: the same count is the same line.
    expect(added(before, before, uiPermissionLines)).toEqual([])
  })

  it('carries severity with the grant instead of guessing it from the sentence', () => {
    // The other half of the same idea. Prefix-matching copy against a table rendered any grant whose
    // sentence missed the table as harmless.
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

  // A permission the plugin gave up is not marked. The prompt asks whether the new reach is
  // acceptable, and a removal is never the thing to hesitate over.
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

describe('the harness grant', () => {
  const contributions = (harnesses: unknown[]) => ({ frames: [], harnesses } as never)

  it('names the program acorn will run and what it carries into it', () => {
    const lines = harnessPermissionLines(harnessGrants(contributions([
      {
        id: 'opencode',
        label: 'OpenCode',
        spawn: { command: 'opencode', args: ['acp'] },
        envPassthrough: ['OPENCODE_*'],
      },
      {
        id: 'gemini',
        label: 'Gemini',
        spawn: { entry: 'dist/adapter.js', args: [] },
        envPassthrough: [],
      },
    ])))

    expect(texts(lines)).toEqual([
      'Run JavaScript this package ships (dist/adapter.js) as the “Gemini” agent',
      'Run “opencode acp” as the “OpenCode” agent and pass it OPENCODE_* from this node’s environment',
    ])
    // The strongest fact a package can state about itself, so it is the one an owner is nudged to read.
    expect(lines.every((line) => line.high)).toBe(true)
  })

  it('reads a changed binary, changed arguments or a widened environment as newly requested', () => {
    const before = harnessGrants(contributions([
      { id: 'h', label: 'H', spawn: { command: 'opencode', args: ['acp'] }, envPassthrough: [] },
    ]))
    const keys = new Set(harnessPermissionLines(before).map((line) => line.key))
    const isNew = (harness: unknown) =>
      harnessPermissionLines(harnessGrants(contributions([harness]))).every((line) => !keys.has(line.key))

    expect(isNew({ id: 'h', label: 'H', spawn: { command: 'opencode', args: ['acp'] }, envPassthrough: [] })).toBe(false)
    // A label edit is a copy edit, not a widening: the sentence changes and the key does not.
    expect(isNew({ id: 'h', label: 'OpenCode', spawn: { command: 'opencode', args: ['acp'] }, envPassthrough: [] })).toBe(false)
    expect(isNew({ id: 'h', label: 'H', spawn: { command: 'curl', args: ['acp'] }, envPassthrough: [] })).toBe(true)
    expect(isNew({ id: 'h', label: 'H', spawn: { command: 'opencode', args: ['acp', '--yolo'] }, envPassthrough: [] })).toBe(true)
    expect(isNew({ id: 'h', label: 'H', spawn: { command: 'opencode', args: ['acp'] }, envPassthrough: ['AWS_*'] })).toBe(true)
  })

  it('names the one-shot invocation on its own line, and reads a change to it as newly requested', () => {
    const withOneShot = (args: string[], modelFlag?: string) => contributions([{
      id: 'opencode',
      label: 'OpenCode',
      spawn: { command: 'opencode', args: ['acp'] },
      envPassthrough: [],
      terminal: { command: 'opencode', backendPreference: 'tmux', launchArgs: [], oneShot: { args, output: 'text', ...(modelFlag ? { modelFlag } : {}) } },
    }])

    const lines = harnessPermissionLines(harnessGrants(withOneShot(['run'], '--model')))
    // Two invocations, two lines. The session spawn is not the one a Generate list runs.
    expect(texts(lines)).toEqual([
      'Run “opencode acp” as the “OpenCode” agent',
      'Runs “opencode run --model MODEL” to generate text',
    ])
    expect(lines.every((line) => line.high)).toBe(true)

    const keys = new Set(lines.map((line) => line.key))
    const isNew = (next: ReturnType<typeof withOneShot>) =>
      harnessPermissionLines(harnessGrants(next)).some((line) => !keys.has(line.key))
    expect(isNew(withOneShot(['run'], '--model'))).toBe(false)
    expect(isNew(withOneShot(['run', '--agent', 'plan'], '--model'))).toBe(true)
    expect(isNew(withOneShot(['run']))).toBe(true)
    // A harness that drops the block loses the line rather than keeping a stale one.
    expect(harnessPermissionLines(harnessGrants(contributions([
      { id: 'opencode', label: 'OpenCode', spawn: { command: 'opencode', args: ['acp'] }, envPassthrough: [] },
    ])))).toHaveLength(1)
  })

  it('discloses nothing for a spawn the node already refused', () => {
    // The node rejected this at parse, so it can never run. A consent line for it would be noise in the
    // one list that must not have any.
    expect(harnessGrants(contributions([{ id: 'h', label: 'H', spawn: { args: [] }, envPassthrough: [] }]))).toEqual([])
  })
})

describe('the cross-plugin grants', () => {
  // Every kind, both directions. A kind added to the protocol with no sentence here is a hole a person
  // would consent through, which is why this is a loop over the vocabulary rather than a list of cases.
  it('has a host-owned sentence for every kind, in both directions', () => {
    for (const pointKind of EXTENSION_POINT_KINDS) {
      for (const kind of ['hosts', 'extends'] as const) {
        const line = extensionPermissionLine({ kind, pointKind, target: 'changes:before-push', label: 'push' })
        expect(line.text.length).toBeGreaterThan(10)
        // The label is manifest text and reaches the sentence quoted, the way a webview surface's does.
        expect(line.text).toContain('“push”')
        // The kind is in the key, so a package that starts bringing something else reads as newly
        // requested rather than sliding past the update prompt.
        expect(line.key).toContain(`:${pointKind}:`)
      }
    }
  })

  it('names the package being reached into on the contributor’s side, and not on the owner’s', () => {
    const extend = extensionPermissionLine({ kind: 'extends', pointKind: 'rows', target: 'changes:card-links', label: 'Linked items' })
    expect(extend.text).toBe('Add its own rows to changes’s “Linked items” list')
    const host = extensionPermissionLine({ kind: 'hosts', pointKind: 'rows', target: 'board:card-links', label: 'Linked items' })
    expect(host.text).toBe('Let other plugins add rows to its “Linked items” list')
  })

  it('says what a hook handler asks to do, and marks the two that change what another plugin does', () => {
    const modes = HOOK_MODES.map((mode) =>
      extensionPermissionLine({ kind: 'extends', pointKind: 'hook', mode, target: 'changes:before-push', label: 'push' }))
    expect(texts(modes)).toEqual([
      'Watch changes’s “push” decision as it happens',
      'Change what changes does when it “push”s',
      'Stop changes from doing “push”',
    ])
    expect(modes.map((line) => line.high)).toEqual([false, true, true])
    // Mode is in the key too: a package that starts vetoing where it used to observe has grown its
    // reach, and the update prompt has to say so.
    expect(new Set(modes.map((line) => line.key)).size).toBe(3)
  })

  it('still discloses a kind this build cannot name, rather than saying nothing', () => {
    // The version-skew case. A shell that cannot describe the kind must not therefore drop the line:
    // "this package reaches into that one" is the disclosure.
    const line = extensionPermissionLine({ kind: 'extends', pointKind: 'sculpture' as never, target: 'changes:thing', label: 'Thing' })
    expect(line.text).toBe('Reach into changes’s “Thing”')
  })

  it('says the exclusive slot is a choice, with no point kind to name', () => {
    const line = extensionPermissionLine({ kind: 'replaces', target: 'rail.taskList', label: 'Board task list' })
    expect(line.text).toBe('Offer to replace acorn’s own rail.taskList — you choose in Settings')
    expect(line.key).toBe('extension:replaces:rail.taskList')
  })
})
