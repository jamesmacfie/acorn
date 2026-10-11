import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginContextMenuDescriptor } from '@acorn/protocol/plugin/contract.ts'
// Type-only, so it is erased and does not evaluate the module before the mock below is installed.
import type {
  AgentMessageTarget,
  AgentTurnTarget,
  ContentSelectionTarget,
  TaskRowTarget,
} from '../registries/panes/contextMenus'

const sendRaw = vi.fn(async (..._args: unknown[]) => ({ ok: true, status: 200 }))
vi.mock('../../infra/node/apiClient', () => ({
  readJson: vi.fn(),
  sendRaw: (...args: unknown[]) => sendRaw(...args),
  writeJson: vi.fn(),
}))

const { contextMenuItems, contextMenuRegistry, runContextMenuItem } = await import('../registries/panes/contextMenus')
const { sourceRegistry } = await import('../registries/sources/sources')
const { paneRegistry } = await import('../registries/panes/panes')
const { pluginContextMenuId, pluginContextMenuItem, registerPluginContextMenu } = await import('./chromeContextMenus')
const { fileMenuTarget } = await import('../registries/panes/contextMenus')
const { setTaskLookup } = await import('../../features/tasks/taskLookup')

// A plugin's menu row: what the host refuses, and what it binds over whatever the manifest said. The
// node checked all of this at parse time; a roster row is bytes a node sent, so it is checked again.

const target = (over: Partial<TaskRowTarget> = {}): TaskRowTarget => ({
  location: 'task.row',
  id: 't1',
  title: 'Ship it',
  origin: 'github',
  projectId: 'p1',
  pinned: false,
  branch: 'me/ship-it',
  ...over,
})

const descriptor = (over: Partial<PluginContextMenuDescriptor> = {}): PluginContextMenuDescriptor => ({
  id: 'open-card',
  location: 'task.row',
  label: 'Open the board card',
  order: 500,
  action: { verb: 'runNodeAction', path: '/v1/p/board/open' },
  ...over,
})

const binding = (over: Partial<{ nodeId: () => string; enabled: () => boolean }> = {}) => ({
  nodeId: () => 'node-a',
  enabled: () => true,
  ...over,
})

const disposables: { dispose(): void }[] = []
afterEach(() => {
  while (disposables.length) disposables.pop()!.dispose()
  sendRaw.mockClear()
})

describe('what the host refuses', () => {
  it('refuses a location this shell does not have', () => {
    // The version-skew case, and the reason `location` is a plain string on the wire: a newer node can
    // describe a location this client cannot draw, and the answer is a named refusal rather than a row
    // registered against nothing.
    expect(() => pluginContextMenuItem('board', descriptor({ location: 'task.footer' }), binding())).toThrow(
      /unknown location 'task.footer'/,
    )
    expect(() => pluginContextMenuItem('board', descriptor({ location: '' }), binding())).toThrow(/unknown location/)
  })

  it('refuses a `when` naming a fact the location does not have', () => {
    // Including the identity fields, which the target genuinely carries: they are deliberately not
    // facts, so matching on one would be a menu row keyed to a single task.
    expect(() => pluginContextMenuItem('board', descriptor({ when: { branch: 'main' } }), binding())).toThrow(
      /does not have: branch/,
    )
    expect(() => pluginContextMenuItem('board', descriptor({ when: { id: 't1' } }), binding())).toThrow(
      /does not have: id/,
    )
    expect(() =>
      pluginContextMenuItem('board', descriptor({ when: { origin: 'github', title: 'x' } }), binding()),
    ).toThrow(/does not have: title/)
  })

  it('accepts the facts the location does have', () => {
    expect(
      pluginContextMenuItem(
        'board',
        descriptor({ when: { origin: 'github', pinned: true, projectId: 'p1' } }),
        binding(),
      ).id,
    ).toBe('plugin:board:open-card')
  })
})

describe('what the host binds', () => {
  it('namespaces the id with its owner, so it cannot take a core row’s place', () => {
    expect(pluginContextMenuId('board', 'open-card')).toBe('plugin:board:open-card')
    const first = pluginContextMenuItem('board', descriptor(), binding())
    const second = pluginContextMenuItem('other', descriptor(), binding())
    expect([first.id, second.id]).toEqual(['plugin:board:open-card', 'plugin:other:open-card'])
  })

  it('hides the row whenever the plugin is not running on the node being looked at', () => {
    let running = true
    const entry = pluginContextMenuItem('board', descriptor(), binding({ enabled: () => running }))
    expect(entry.when!(target())).toBe(true)
    running = false
    expect(entry.when!(target())).toBe(false)
  })

  it('ANDs the enablement gate with the declared predicate', () => {
    const entry = pluginContextMenuItem('board', descriptor({ when: { origin: 'github' } }), binding())
    expect(entry.when!(target({ origin: 'github' }))).toBe(true)
    expect(entry.when!(target({ origin: 'local' }))).toBe(false)
  })

  it('sends the verb the id of the thing that was right-clicked, and nothing the descriptor chose', async () => {
    disposables.push(registerPluginContextMenu('board', descriptor(), binding()))
    const entry = contextMenuItems('task.row', target())[0]!
    entry.run(target({ id: 'task-42' }))
    await Promise.resolve()
    expect(sendRaw).toHaveBeenCalledWith(
      '/v1/p/board/open',
      expect.objectContaining({
        method: 'POST',
        nodeId: 'node-a',
        body: JSON.stringify({ item: 'task-42' }),
      }),
    )
  })

  it('carries no tone: a red row is core’s claim about core’s resources', () => {
    expect(pluginContextMenuItem('board', descriptor(), binding()).tone).toBeUndefined()
  })
})

describe('rail menu ownership and execution', () => {
  const sourceTarget = {
    location: 'rail.source' as const,
    id: 'feed',
    title: 'Feed',
    nodeId: 'node-a',
    projectId: 'project-1',
  }
  const paneTarget = {
    location: 'rail.pane' as const,
    id: 'board-pane',
    title: 'Board',
    nodeId: 'node-a',
    taskId: 'task-1',
    projectId: 'project-1',
    pinned: false,
    shown: true,
  }
  const railBinding = () => ({ ...binding(), sources: new Set(['feed']), panes: new Set(['board-pane']) })

  it('dispatches loaded source and pane actions with only host-derived rail context', async () => {
    disposables.push(
      sourceRegistry.register({ id: 'feed', label: 'Feed', glyph: 'list', order: 1, component: () => null }, 'board'),
    )
    disposables.push(
      paneRegistry.register(
        { id: 'board-pane', label: 'Board', glyph: 'list', order: 1, component: () => null },
        'board',
      ),
    )
    disposables.push(
      registerPluginContextMenu('board', descriptor({ location: 'rail.source', surface: 'feed' }), railBinding()),
    )
    disposables.push(
      registerPluginContextMenu(
        'board',
        descriptor({ id: 'pane-action', location: 'rail.pane', surface: 'board-pane' }),
        railBinding(),
      ),
    )
    const source = contextMenuItems('rail.source', sourceTarget)[0]!
    const pane = contextMenuItems('rail.pane', paneTarget)[0]!
    source.run(sourceTarget)
    pane.run(paneTarget)
    await Promise.resolve()
    expect(sendRaw.mock.calls.map((call) => JSON.parse((call[1] as { body: string }).body))).toEqual([
      { rail: { location: 'rail.source', sourceId: 'feed', projectId: 'project-1' } },
      { rail: { location: 'rail.pane', paneId: 'board-pane', taskId: 'task-1', projectId: 'project-1' } },
    ])
    // A captured item cannot invoke the replacement after a plugin reload.
    disposables.pop()!.dispose()
    pane.run(paneTarget)
    expect(sendRaw).toHaveBeenCalledTimes(2)
  })

  it('refuses foreign or undeclared surfaces and stale target nodes', () => {
    expect(() =>
      pluginContextMenuItem('board', descriptor({ location: 'rail.source', surface: 'other' }), railBinding()),
    ).toThrow(/undeclared/)
    disposables.push(
      sourceRegistry.register({ id: 'feed', label: 'Feed', glyph: 'list', order: 1, component: () => null }, 'foreign'),
    )
    disposables.push(
      registerPluginContextMenu('board', descriptor({ location: 'rail.source', surface: 'feed' }), railBinding()),
    )
    expect(contextMenuItems('rail.source', sourceTarget)).toEqual([])
    const entry = contextMenuRegistry.get('plugin:board:open-card')!
    entry.run({ ...sourceTarget, nodeId: 'other-node' })
    expect(sendRaw).not.toHaveBeenCalled()
  })
})

describe('file and document menus', () => {
  const inspect = descriptor({
    id: 'inspect',
    location: 'file.row',
    when: { extension: 'json', directory: false },
    action: { verb: 'runNodeAction', path: '/v1/p/inspector/inspect' },
  })
  const fileTarget = (over: Partial<Parameters<typeof fileMenuTarget>[1]> = {}) =>
    fileMenuTarget('file.row', {
      nodeId: 'node-a',
      ownerPluginId: 'editor',
      taskId: 'task-1',
      projectId: 'project-1',
      path: 'src/Data.json',
      title: 'Data.json',
      directory: false,
      readOnly: false,
      ...over,
    })
  afterEach(() => setTaskLookup(() => undefined))
  const tasks = (rows: { id: string; projectId: string }[]) =>
    setTaskLookup((id) => rows.find((row) => row.id === id) as never)

  it('sends the confined resource and nothing else, through the contributor’s own route', async () => {
    tasks([{ id: 'task-1', projectId: 'project-1' }])
    disposables.push(registerPluginContextMenu('inspector', inspect, binding()))
    const entry = contextMenuItems('file.row', fileTarget())[0]!
    entry.run(fileTarget({ revision: 'sha-1' }))
    await Promise.resolve()
    expect(sendRaw).toHaveBeenCalledWith(
      '/v1/p/inspector/inspect',
      expect.objectContaining({ method: 'POST', nodeId: 'node-a' }),
    )
    // No absolute path, no title, no owner, no bytes: the route reads through a capability if it
    // needs the file.
    expect(JSON.parse((sendRaw.mock.calls[0]![1] as { body: string }).body)).toEqual({
      resource: {
        kind: 'file',
        taskId: 'task-1',
        projectId: 'project-1',
        path: 'src/Data.json',
        directory: false,
        readOnly: false,
        revision: 'sha-1',
      },
    })
  })

  it('matches on the file facts, and accepts a row from any plugin with no surface', () => {
    disposables.push(registerPluginContextMenu('inspector', inspect, binding()))
    expect(contextMenuItems('file.row', fileTarget()).map((entry) => entry.id)).toEqual(['plugin:inspector:inspect'])
    expect(contextMenuItems('file.row', fileTarget({ path: 'src/data.ts' }))).toEqual([])
    expect(contextMenuItems('file.row', fileTarget({ path: 'fixtures.json', directory: true }))).toEqual([])
    // Each location keeps its own rows.
    expect(contextMenuItems('document.tab', { ...fileTarget(), location: 'document.tab' })).toEqual([])
    expect(() => pluginContextMenuItem('inspector', { ...inspect, surface: 'files' }, binding())).toThrow(
      /gives a surface/,
    )
    expect(() => pluginContextMenuItem('inspector', { ...inspect, when: { path: 'a.json' } }, binding())).toThrow(
      /does not have: path/,
    )
  })

  it('refuses a changed Node, a task no longer in its project, and an unloaded contributor', () => {
    tasks([{ id: 'task-1', projectId: 'project-1' }])
    let enabled = true
    const handle = registerPluginContextMenu('inspector', inspect, binding({ enabled: () => enabled }))
    const entry = contextMenuItems('file.row', fileTarget())[0]!
    entry.run(fileTarget({ nodeId: 'node-b' }))
    entry.run(fileTarget({ taskId: 'task-gone' }))
    entry.run(fileTarget({ projectId: 'project-2' }))
    enabled = false
    entry.run(fileTarget())
    enabled = true
    handle.dispose()
    entry.run(fileTarget())
    expect(sendRaw).not.toHaveBeenCalled()
  })

  it('never runs a captured row after its registration was replaced', () => {
    tasks([{ id: 'task-1', projectId: 'project-1' }])
    const first = registerPluginContextMenu('inspector', inspect, binding())
    const captured = contextMenuItems('file.row', fileTarget())[0]!
    first.dispose()
    disposables.push(registerPluginContextMenu('inspector', inspect, binding()))
    captured.run(fileTarget())
    expect(sendRaw).not.toHaveBeenCalled()
  })
})

describe('agent message and turn menus', () => {
  const note = descriptor({
    id: 'note',
    location: 'agent.message',
    when: { role: 'assistant' },
    action: { verb: 'runNodeAction', path: '/v1/p/notes/file' },
  })
  const message = (over: Partial<AgentMessageTarget> = {}): AgentMessageTarget => ({
    location: 'agent.message',
    nodeId: 'node-a',
    taskId: 'task-1',
    projectId: 'project-1',
    sessionId: 'session-1',
    itemId: 'event-7',
    turnId: 'turn-2',
    role: 'assistant',
    status: 'completed',
    text: 'Ship it.',
    revision: 9,
    ...over,
  })
  const turn: AgentTurnTarget = {
    location: 'agent.turn',
    nodeId: 'node-a',
    taskId: 'task-1',
    projectId: 'project-1',
    sessionId: 'session-1',
    turnId: 'turn-2',
    status: 'failed',
    revision: 12,
  }
  beforeEach(() => setTaskLookup((id) => (id === 'task-1' ? { id, projectId: 'project-1' } : undefined) as never))
  afterEach(() => setTaskLookup(() => undefined))
  const bodies = () => sendRaw.mock.calls.map((call) => JSON.parse((call[1] as { body: string }).body))

  it('sends the message’s identity and shown text, and the turn’s identity, and nothing else', async () => {
    disposables.push(registerPluginContextMenu('notes', note, binding()))
    disposables.push(
      registerPluginContextMenu(
        'notes',
        { ...note, id: 'turn', location: 'agent.turn', when: { status: 'failed' } },
        binding(),
      ),
    )
    contextMenuItems('agent.message', message())[0]!.run(message({ text: 'Ship', textTruncated: true }))
    contextMenuItems('agent.turn', turn)[0]!.run(turn)
    await Promise.resolve()
    expect(bodies()).toEqual([
      {
        message: {
          taskId: 'task-1',
          projectId: 'project-1',
          sessionId: 'session-1',
          itemId: 'event-7',
          turnId: 'turn-2',
          role: 'assistant',
          status: 'completed',
          text: 'Ship',
          textTruncated: true,
          revision: 9,
        },
      },
      {
        turn: {
          taskId: 'task-1',
          projectId: 'project-1',
          sessionId: 'session-1',
          turnId: 'turn-2',
          status: 'failed',
          revision: 12,
        },
      },
    ])
  })

  it('matches on role and status', () => {
    disposables.push(registerPluginContextMenu('notes', note, binding()))
    expect(contextMenuItems('agent.message', message())).toHaveLength(1)
    expect(contextMenuItems('agent.message', message({ role: 'user' }))).toEqual([])
    expect(contextMenuItems('agent.turn', turn)).toEqual([])
  })

  it('refuses a changed Node, a task gone or moved, an unloaded contributor, and a replaced registration', () => {
    let enabled = true
    const handle = registerPluginContextMenu('notes', note, binding({ enabled: () => enabled }))
    const entry = contextMenuItems('agent.message', message())[0]!
    entry.run(message({ nodeId: 'node-b' }))
    entry.run(message({ taskId: 'task-gone' }))
    entry.run(message({ projectId: 'project-2' }))
    enabled = false
    entry.run(message())
    enabled = true
    handle.dispose()
    disposables.push(registerPluginContextMenu('notes', note, binding()))
    runContextMenuItem(entry, message())
    expect(sendRaw).not.toHaveBeenCalled()
  })
})

describe('selection menus', () => {
  const explain = descriptor({
    id: 'explain',
    location: 'content.selection',
    when: { contentKind: 'document' },
    action: { verb: 'runNodeAction', path: '/v1/p/explain/run' },
  })
  const selection = (over: Partial<ContentSelectionTarget> = {}): ContentSelectionTarget => ({
    location: 'content.selection',
    nodeId: 'node-a',
    taskId: 'task-1',
    projectId: 'project-1',
    ownerId: 'editor',
    contentKind: 'document',
    languageId: 'typescript',
    readOnly: false,
    text: 'const a = 1',
    revision: 4,
    resource: { kind: 'file', path: 'src/a.ts' },
    range: { start: { line: 2, column: 1 }, end: { line: 2, column: 12 } },
    ...over,
  })
  beforeEach(() => setTaskLookup((id) => (id === 'task-1' ? { id, projectId: 'project-1' } : undefined) as never))
  afterEach(() => setTaskLookup(() => undefined))
  const bodies = () => sendRaw.mock.calls.map((call) => JSON.parse((call[1] as { body: string }).body))

  it('sends the selected text with its owner, revision, resource and range, and nothing else', async () => {
    disposables.push(registerPluginContextMenu('explain', explain, binding()))
    contextMenuItems('content.selection', selection())[0]!.run(selection())
    // A plugin's own document in a project has no task, and still reaches its route.
    const { taskId: _taskId, resource: _resource, ...projectDocument } = selection({ ownerId: 'database' })
    contextMenuItems('content.selection', projectDocument)[0]!.run(projectDocument)
    await Promise.resolve()
    expect(bodies()).toEqual([
      {
        selection: {
          taskId: 'task-1',
          projectId: 'project-1',
          ownerId: 'editor',
          contentKind: 'document',
          languageId: 'typescript',
          readOnly: false,
          text: 'const a = 1',
          revision: 4,
          resource: { kind: 'file', path: 'src/a.ts' },
          range: { start: { line: 2, column: 1 }, end: { line: 2, column: 12 } },
        },
      },
      {
        selection: {
          projectId: 'project-1',
          ownerId: 'database',
          contentKind: 'document',
          languageId: 'typescript',
          readOnly: false,
          text: 'const a = 1',
          revision: 4,
          range: { start: { line: 2, column: 1 }, end: { line: 2, column: 12 } },
        },
      },
    ])
  })

  it('matches on the kind of content', () => {
    disposables.push(registerPluginContextMenu('explain', explain, binding()))
    expect(contextMenuItems('content.selection', selection())).toHaveLength(1)
    expect(contextMenuItems('content.selection', selection({ contentKind: 'markdown' }))).toEqual([])
  })

  it('refuses a changed Node, a task gone or moved, an unloaded contributor, and a replaced registration', () => {
    let enabled = true
    const handle = registerPluginContextMenu('explain', explain, binding({ enabled: () => enabled }))
    const entry = contextMenuItems('content.selection', selection())[0]!
    entry.run(selection({ nodeId: 'node-b' }))
    entry.run(selection({ taskId: 'task-gone' }))
    // An owner that couldn't find the task leaves the project out. That is still a task gone.
    const { projectId: _projectId, ...unknownTask } = selection({ taskId: 'task-gone' })
    entry.run(unknownTask)
    entry.run(selection({ projectId: 'project-2' }))
    enabled = false
    entry.run(selection())
    enabled = true
    handle.dispose()
    disposables.push(registerPluginContextMenu('explain', explain, binding()))
    runContextMenuItem(entry, selection())
    expect(sendRaw).not.toHaveBeenCalled()
  })
})

describe('registering one', () => {
  it('lands in the same list core’s rows come from', () => {
    disposables.push(registerPluginContextMenu('board', descriptor(), binding()))
    expect(contextMenuItems('task.row', target()).map((entry) => entry.id)).toEqual(['plugin:board:open-card'])
  })

  it('takes the row with it on dispose', () => {
    const entry = registerPluginContextMenu('board', descriptor(), binding())
    entry.dispose()
    expect(contextMenuRegistry.entries()).toEqual([])
  })
})
