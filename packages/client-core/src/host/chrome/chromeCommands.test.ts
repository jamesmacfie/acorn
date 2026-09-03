import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PluginCommandDescriptor } from '@acorn/protocol/api.ts'

const readJson = vi.fn(async (..._args: unknown[]): Promise<unknown> => ({ items: [] }))
const writeJson = vi.fn(async (..._args: unknown[]): Promise<unknown> => ({ ok: true }))
type RawResult = { ok: boolean; status: number; error?: { code: string; message: string } }
const sendRaw = vi.fn(async (..._args: unknown[]): Promise<RawResult> => ({ ok: true, status: 200 }))
vi.mock('../../infra/node/apiClient', () => ({
  readJson: (...args: unknown[]) => readJson(...args),
  writeJson: (...args: unknown[]) => writeJson(...args),
  sendRaw: (...args: unknown[]) => sendRaw(...args),
}))

const { pluginCommand, usablePluginCommands } = await import('./chromeCommands')
const { projectSurfaceRegistry } = await import('../registries/panes/projectSurfaces')
type CommandExecutionContext = import('../registries/commands/commands').CommandExecutionContext
type SearchCommand = import('../registries/commands/commands').SearchCommand
type InputCommand = import('../registries/commands/commands').InputCommand
type SettingCommand = import('../registries/commands/commands').SettingCommand

// A loaded plugin's interactive commands, which is where a manifest meets a route's answer.
//
// Two boundaries are worth the length. The host decides what a route is asked — the reader's text and
// the identifiers the declared scope owns, and nothing a descriptor or a previous answer wrote. And the
// answer decides nothing: it carries display facts and identity, and the verb that runs when a row is
// picked is the static one the manifest declared (docs/future/command-palette/refused.md § Returning
// executable commands from a loaded search response).

const CONTEXT: CommandExecutionContext = {
  host: 'desktop', nodeId: 'node-b', workspaceId: 'w-1', projectId: 'p-1', taskId: 't-1',
  paneId: null, surfaceId: null,
}

const binding = { nodeId: () => 'node-a', enabled: () => true, usableAction: () => true, usableSelectAction: () => true }

const searchDescriptor = (over: Record<string, unknown> = {}): PluginCommandDescriptor => ({
  id: 'find', title: 'Find an issue', category: 'action', palette: true, kind: 'search',
  scope: 'node', route: '/v2/p/linear/search',
  onSelect: { verb: 'runNodeAction', path: '/v2/p/linear/open' },
  ...over,
} as PluginCommandDescriptor)

const inputDescriptor = (over: Record<string, unknown> = {}): PluginCommandDescriptor => ({
  id: 'ask', title: 'Generate SQL', category: 'action', palette: true, kind: 'input',
  scope: 'task', route: '/v2/p/database/generate',
  onSuccess: { verb: 'runNodeAction', path: '/v2/p/database/open' },
  ...over,
} as PluginCommandDescriptor)

const settingDescriptor = (over: Record<string, unknown> = {}): PluginCommandDescriptor => ({
  id: 'theme', title: 'Board theme', category: 'action', palette: true, kind: 'setting',
  scope: 'project', readRoute: '/v2/p/linear/theme', writeRoute: '/v2/p/linear/theme',
  options: [{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }],
  ...over,
} as PluginCommandDescriptor)

const signal = (): AbortSignal => new AbortController().signal

afterEach(() => {
  readJson.mockReset()
  readJson.mockResolvedValue({ items: [] })
  writeJson.mockReset()
  writeJson.mockResolvedValue({ ok: true })
  sendRaw.mockReset()
  sendRaw.mockResolvedValue({ ok: true, status: 200 })
})

describe('what the host binds', () => {
  it('qualifies the id, the parent and the owner, and never reads them off the manifest', () => {
    const command = pluginCommand('linear', {
      id: 'find', title: 'Find', category: 'action', palette: true, kind: 'search',
      scope: 'node', route: '/v2/p/linear/search', parentId: 'issues',
      onSelect: { verb: 'openTask' },
    } as PluginCommandDescriptor, binding)
    expect(command.id).toBe('plugin.linear.find')
    expect(command.parentId).toBe('plugin.linear.issues')
    expect(command.ownerId).toBe('linear')
    expect(command.kind).toBe('search')
  })

  it('makes a group a group and an omitted kind an action, which is what every shipped manifest is', () => {
    const group = pluginCommand('linear', {
      id: 'issues', title: 'Issues', category: 'navigation', palette: true, kind: 'group',
    } as PluginCommandDescriptor, binding)
    expect(group.kind).toBe('group')

    const legacy = pluginCommand('linear', {
      id: 'sync', title: 'Sync', category: 'action', palette: true,
      action: { verb: 'runNodeAction', path: '/v2/p/linear/sync' },
    } as PluginCommandDescriptor, binding)
    expect(legacy.kind).toBeUndefined()
  })
})

describe('a search command', () => {
  it('asks for the reader’s text and the identifiers its scope owns, and nothing else', async () => {
    const command = pluginCommand('linear', searchDescriptor({ scope: 'task' }), binding) as SearchCommand
    await command.query('rol', CONTEXT, signal())
    expect(readJson).toHaveBeenCalledWith('/v2/p/linear/search?q=rol&taskId=t-1', expect.objectContaining({ nodeId: 'node-b' }))

    const project = pluginCommand('linear', searchDescriptor({ scope: 'project' }), binding) as SearchCommand
    await project.query('rol', CONTEXT, signal())
    expect(readJson).toHaveBeenLastCalledWith('/v2/p/linear/search?q=rol&projectId=p-1', expect.anything())

    // `node` is the default and is not a parameter: which node answers is an API-client option.
    const node = pluginCommand('linear', searchDescriptor(), binding) as SearchCommand
    await node.query('rol', CONTEXT, signal())
    expect(readJson).toHaveBeenLastCalledWith('/v2/p/linear/search?q=rol', expect.anything())
  })

  it('drops a malformed row, caps the rest, and keeps only the fields it names', async () => {
    readJson.mockResolvedValue({
      items: [
        { id: 'i-1', title: 'One', subtitle: 'runn/runn', badge: '2', ref: 'ENG-1', extra: 'ignored' },
        { id: 'i-2' },
        { title: 'no id' },
        'not even an object',
        ...Array.from({ length: 60 }, (_, at) => ({ id: `bulk-${at}`, title: `Bulk ${at}` })),
      ],
    })
    const command = pluginCommand('linear', searchDescriptor(), binding) as SearchCommand
    const rows = await command.query('rol', CONTEXT, signal())
    expect(rows).toHaveLength(50)
    expect(rows[0]).toEqual({ id: 'i-1', title: 'One', subtitle: 'runn/runn', badge: '2', ref: 'ENG-1' })
  })

  it('cannot be told what to do by the thing it is showing', async () => {
    readJson.mockResolvedValue({
      items: [{
        id: 'i-1',
        title: 'One',
        // Everything a hostile answer would want to say, and none of it survives the sanitiser.
        action: { verb: 'openUrl', url: 'https://evil.test' },
        route: '/v2/tasks',
        url: 'https://evil.test',
        taskId: 't-9',
      }],
    })
    const command = pluginCommand('linear', searchDescriptor(), binding) as SearchCommand
    const rows = await command.query('rol', CONTEXT, signal())
    expect(rows[0]).toEqual({ id: 'i-1', title: 'One', taskId: 't-9' })

    await command.select(rows[0], CONTEXT)
    // The route the manifest declared, with the row's id as its subject. The row's own path and verb
    // reached nothing.
    expect(sendRaw).toHaveBeenCalledWith('/v2/p/linear/open', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ item: 'i-1' }),
    }))
  })

  it('reports a refused action rather than closing over it', async () => {
    sendRaw.mockResolvedValue({ ok: false, status: 500, error: { code: 'boom', message: 'the node fell over' } })
    const command = pluginCommand('linear', searchDescriptor(), binding) as SearchCommand
    await expect(command.select({ id: 'i-1', title: 'One' }, CONTEXT)).rejects.toThrow('the node fell over')
  })

  // `navigate` is the verb Rollbar and Linear pick a row with: their detail belongs to the project, so
  // a pick changes the URL and the surface beside the list follows
  // (docs/future/command-palette/phase-5-loaded-plugin-adoption.md).
  describe('picking a row that navigates', () => {
    const navigating = searchDescriptor({ onSelect: { verb: 'navigate', surface: 'rollbar-item' } })

    it('mints the path from the registered pattern, the captured project and the sanitized row id', async () => {
      const surface = projectSurfaceRegistry.register({
        id: 'rollbar-item',
        path: '/p/:projectId/x/rollbar/items/:item',
        item: 'item',
        order: 60,
        component: (() => null) as never,
      })
      const navigate = vi.fn()
      const command = pluginCommand('rollbar', navigating, binding) as SearchCommand
      const outcome = await command.select({ id: 'conn-1:142', title: 'TypeError' }, { ...CONTEXT, navigate })
      expect(navigate).toHaveBeenCalledWith('/p/p-1/x/rollbar/items/conn-1%3A142')
      expect(outcome).toEqual({ effect: 'close' })
      surface.dispose()
    })

    it('refuses rather than guessing when this host has nowhere to take the reader', async () => {
      const command = pluginCommand('rollbar', navigating, binding) as SearchCommand
      // No navigator on the context, which is a shortcut rather than a palette session, and no
      // registered surface either. Both are the same answer: nothing happens and the frame says so.
      await expect(command.select({ id: 'conn-1:142', title: 'TypeError' }, CONTEXT)).rejects.toThrow('project')
    })
  })
})

describe('an input command', () => {
  it('posts the line and its scope, then runs the declared success verb', async () => {
    writeJson.mockResolvedValue({ ok: true, item: { id: 'q-1', title: 'Saved query' } })
    const command = pluginCommand('database', inputDescriptor(), binding) as InputCommand
    const outcome = await command.submit('rows per project', CONTEXT, signal())
    expect(writeJson).toHaveBeenCalledWith('/v2/p/database/generate', expect.objectContaining({
      method: 'POST',
      nodeId: 'node-b',
      body: JSON.stringify({ input: 'rows per project', taskId: 't-1' }),
    }))
    expect(sendRaw).toHaveBeenCalledWith('/v2/p/database/open', expect.objectContaining({
      body: JSON.stringify({ item: 'q-1' }),
    }))
    expect(outcome).toEqual({ effect: 'close' })
  })

  it('keeps the frame open when the route said something worth reading', async () => {
    writeJson.mockResolvedValue({ ok: true, message: 'Wrote the query to the scratch document.' })
    const command = pluginCommand('database', inputDescriptor(), binding) as InputCommand
    expect(await command.submit('rows', CONTEXT, signal()))
      .toEqual({ effect: 'stay', status: 'Wrote the query to the scratch document.' })
  })

  it('runs no action at all when the submission failed', async () => {
    writeJson.mockRejectedValue(new Error('syntax error at or near "slect"'))
    const command = pluginCommand('database', inputDescriptor(), binding) as InputCommand
    await expect(command.submit('slect 1', CONTEXT, signal())).rejects.toThrow('syntax error')
    expect(sendRaw).not.toHaveBeenCalled()
  })

  it('refuses an answer this build cannot read, rather than acting on half of one', async () => {
    writeJson.mockResolvedValue({ ok: 'yes please' })
    const command = pluginCommand('database', inputDescriptor(), binding) as InputCommand
    await expect(command.submit('rows', CONTEXT, signal())).rejects.toThrow('cannot read')
    expect(sendRaw).not.toHaveBeenCalled()
  })
})

describe('which descriptors this device will honour', () => {
  const usable = (descriptors: PluginCommandDescriptor[]): string[] =>
    usablePluginCommands('linear', descriptors, binding).map((descriptor) => descriptor.id)

  it('refuses a route outside the plugin’s own namespace', () => {
    expect(usable([
      searchDescriptor({ id: 'own' }),
      searchDescriptor({ id: 'core', route: '/v2/tasks' }),
      searchDescriptor({ id: 'neighbour', route: '/v2/p/rollbar/search' }),
      searchDescriptor({ id: 'escaped', route: '/v2/p/linear/../rollbar/search' }),
      inputDescriptor({ id: 'posts-core', route: '/v2/tasks' }),
    ])).toEqual(['own'])
  })

  it('refuses a verb this device cannot honour, on a search as on an action', () => {
    const refuse = (action: { verb: string }): boolean => action.verb !== 'openPane'
    const refusing = { ...binding, usableAction: refuse, usableSelectAction: refuse }
    expect(usablePluginCommands('linear', [
      searchDescriptor({ id: 'fine' }),
      searchDescriptor({ id: 'undrawable', onSelect: { verb: 'openPane', pane: 'nope' } }),
    ], refusing).map((descriptor) => descriptor.id)).toEqual(['fine'])
  })

  it('skips a kind this build has no frame for rather than treating it as an action', () => {
    expect(usable([
      { id: 'later', title: 'A sixth kind', category: 'action', palette: true, kind: 'toggle' } as unknown as PluginCommandDescriptor,
      searchDescriptor(),
    ])).toEqual(['find'])
  })

  it('refuses a setting whose routes are not its own, or that declares too few choices', () => {
    expect(usable([
      settingDescriptor({ id: 'own' }),
      settingDescriptor({ id: 'reads-core', readRoute: '/v2/prefs' }),
      settingDescriptor({ id: 'writes-a-neighbour', writeRoute: '/v2/p/rollbar/theme' }),
      settingDescriptor({ id: 'one-choice', options: [{ value: 'on', label: 'On' }] }),
    ])).toEqual(['own'])
  })

  it('drops a child whose parent is missing, is not a group, or is its own descendant', () => {
    const group = (id: string): PluginCommandDescriptor =>
      ({ id, title: id, category: 'navigation', palette: true, kind: 'group' } as PluginCommandDescriptor)
    expect(usable([
      group('issues'),
      searchDescriptor({ id: 'kept', parentId: 'issues' }),
      searchDescriptor({ id: 'orphan', parentId: 'gone' }),
      searchDescriptor({ id: 'under-a-leaf', parentId: 'kept' }),
      { ...group('loop-a'), parentId: 'loop-b' } as PluginCommandDescriptor,
      { ...group('loop-b'), parentId: 'loop-a' } as PluginCommandDescriptor,
    ])).toEqual(['issues', 'kept'])
  })

  it('drops a child of a parent this device already refused, rather than promoting it', () => {
    expect(usable([
      { id: 'issues', title: 'Issues', category: 'navigation', palette: true, kind: 'group', parentId: 'gone' } as PluginCommandDescriptor,
      searchDescriptor({ id: 'inside', parentId: 'issues' }),
    ])).toEqual([])
  })
})

describe('a loaded setting', () => {
  const command = (over: Record<string, unknown> = {}): SettingCommand =>
    pluginCommand('linear', settingDescriptor(over), binding) as SettingCommand

  it('reads the current value from the plugin’s own route, with the identifiers its scope owns', async () => {
    readJson.mockResolvedValue({ value: 'dark' })
    await expect(command().read(CONTEXT, signal())).resolves.toBe('dark')
    // The project, because the descriptor said `project`. Never the task, which the session also
    // captured and this scope does not own.
    expect(readJson).toHaveBeenCalledWith('/v2/p/linear/theme?projectId=p-1', expect.objectContaining({ nodeId: 'node-b' }))
  })

  it('writes the chosen value and answers with the value the node says is now stored', async () => {
    writeJson.mockResolvedValue({ value: 'light' })
    await expect(command().write('dark', CONTEXT, signal())).resolves.toBe('light')
    expect(writeJson).toHaveBeenCalledWith('/v2/p/linear/theme', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ value: 'dark', projectId: 'p-1' }),
    }))
  })

  it('refuses to write a value the manifest never declared', async () => {
    await expect(command().write('neon', CONTEXT, signal())).rejects.toThrow('not one of the choices')
    expect(writeJson).not.toHaveBeenCalled()
  })

  it('refuses an answer this build cannot read, rather than showing an unmarked list', async () => {
    readJson.mockResolvedValue({ theme: 'dark' })
    await expect(command().read(CONTEXT, signal())).rejects.toThrow('cannot read')
  })

  it('carries the manifest’s choices through unchanged, because they are what a value is checked against', () => {
    expect(command().options).toEqual([{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }])
  })
})
