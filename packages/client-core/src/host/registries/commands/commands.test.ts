import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TelemetryRecord } from '@acorn/protocol/telemetry.ts'
import type { Disposable } from '../../../kit/lib/registry'
import {
  _resetClientTelemetry,
  flushTelemetry,
  setTelemetryEnabled,
  startClientTelemetry,
} from '../../../infra/telemetry/emitter'
import {
  COMMAND_CLOSED,
  commandAvailable,
  commandHint,
  commandRegistry,
  commandTitle,
  DETACHED_COMMAND_CONTEXT,
  executeCommand,
  isActionCommand,
  registerCommands,
  stampCommandOwner,
  type CommandContribution,
  type CommandExecutionContext,
} from './commands'

// The command contract, as the two things everything else builds on: what the palette shows, and what
// running one does.
//
// The first half is characterization, written before the shared session existed so that the session
// could be held to it. It is: `./session.test.tsx` asserts the same order over real rows, and neither
// host composes a list of its own any more. What stays here is the registry's own half — which
// commands are discoverable, when a dynamic title is read, and that a palette row and a shortcut
// reach one registration by the same id.

const held: Disposable[] = []
const register = (command: CommandContribution): CommandContribution => {
  held.push(commandRegistry.register(command))
  return command
}

// Registries are module singletons, so every test takes its own registrations back out.
afterEach(() => {
  for (const disposable of held.splice(0).reverse()) disposable.dispose()
})

const leaf = (id: string, over: Partial<CommandContribution> = {}): CommandContribution => ({
  id,
  title: id,
  category: 'action',
  palette: true,
  run: () => {},
  ...over,
} as CommandContribution)

/** The action rows, built exactly as both hosts build them. */
const paletteActions = (): { id: string; label: string; hint?: string }[] =>
  commandRegistry
    .entries()
    .filter((command) => command.palette && commandAvailable(command))
    .map((command) => ({ id: command.id, label: commandTitle(command), hint: commandHint(command) }))

describe('what the palette discovers', () => {
  it('needs the palette flag AND availability, not either one', () => {
    register(leaf('cmd.shown'))
    register(leaf('cmd.quiet', { palette: false }))
    register(leaf('cmd.gated', { when: () => false }))
    register(leaf('cmd.unsupported', { requires: 'desktop' }))
    // `requires` is the host's question and `when` is the contribution's; a command needs both, and a
    // command nobody flagged for the palette is reachable by shortcut and invisible here.
    expect(paletteActions().map((row) => row.id)).toEqual(['cmd.shown'])
  })

  it('resolves a title and a hint that are functions, every time it reads them', () => {
    let suffix = 'one'
    register(leaf('cmd.dynamic', { title: () => `Title ${suffix}`, hint: () => `hint ${suffix}` }))
    expect(paletteActions()[0]).toEqual({ id: 'cmd.dynamic', label: 'Title one', hint: 'hint one' })
    suffix = 'two'
    expect(paletteActions()[0]).toEqual({ id: 'cmd.dynamic', label: 'Title two', hint: 'hint two' })
  })

  it('follows registration order, because nothing sorts the flat list', () => {
    register(leaf('cmd.b'))
    register(leaf('cmd.a'))
    expect(paletteActions().map((row) => row.id)).toEqual(['cmd.b', 'cmd.a'])
  })
})

describe('the row a command becomes', () => {
  it('is addressed by the command’s own id, from the palette and from a shortcut', async () => {
    // Why a shortcut and a palette row reach one registration. A task row is `task:<id>` and a
    // workspace row is `workspace:<id>`, because those ids are only unique within their own kind; a
    // command's row is the command id itself, which is also what a keybinding's `command` names
    // (./keybindings.ts) and what both key layers hand to `executeCommand`.
    const run = vi.fn()
    register(leaf('cmd.same', { run }))
    expect(paletteActions().map((row) => row.id)).toEqual(['cmd.same'])
    // The palette's path and a shortcut's path reaching the one registered leaf. The row the session
    // builds around that id is ./session.test.tsx.
    await executeCommand('cmd.same')
    await executeCommand('cmd.same')
    expect(run).toHaveBeenCalledTimes(2)
  })
})

describe('executing a command', () => {
  it('runs a synchronous leaf and answers close', async () => {
    const run = vi.fn()
    register(leaf('cmd.sync', { run }))
    expect(await executeCommand('cmd.sync')).toEqual(COMMAND_CLOSED)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('awaits an asynchronous leaf before answering', async () => {
    const done: string[] = []
    register(leaf('cmd.async', {
      run: async () => {
        await Promise.resolve()
        done.push('ran')
      },
    }))
    expect(await executeCommand('cmd.async')).toEqual(COMMAND_CLOSED)
    expect(done).toEqual(['ran'])
  })

  it('keeps a zero-argument callback working and hands a detached context to one that wants it', async () => {
    // The compatibility case the whole union exists to preserve: every registration in the repo was
    // written as `run: () => …`, and a function that ignores its argument is still assignable to one
    // that is handed a context.
    const legacy = vi.fn(() => {})
    register(leaf('cmd.legacy', { run: legacy }))
    await executeCommand('cmd.legacy')
    expect(legacy).toHaveBeenCalledWith(DETACHED_COMMAND_CONTEXT)

    let seen: CommandExecutionContext | undefined
    register(leaf('cmd.context', { run: (context) => { seen = context } }))
    await executeCommand('cmd.context')
    // No session captured it, so every identity is absent rather than borrowed from the ambient state.
    expect(seen).toEqual({
      nodeId: null,
      workspaceId: null,
      projectId: null,
      taskId: null,
      paneId: null,
      surfaceId: null,
    })

    const captured: CommandExecutionContext = { ...DETACHED_COMMAND_CONTEXT, host: 'tui', taskId: 't-1' }
    await executeCommand('cmd.context', captured)
    expect(seen).toBe(captured)
  })

  it('normalises a stated outcome and leaves it alone', async () => {
    register(leaf('cmd.stay', { run: () => ({ effect: 'stay', status: 'Saved' }) }))
    expect(await executeCommand('cmd.stay')).toEqual({ effect: 'stay', status: 'Saved' })
  })

  it('re-checks availability at the moment it runs, not when the row was built', async () => {
    // The row a palette drew a second ago may name a command whose `when` has since gone false, and
    // the registry lookup is where that is caught.
    const run = vi.fn()
    let open = true
    register(leaf('cmd.gated', { when: () => open, run }))
    await executeCommand('cmd.gated')
    open = false
    expect(await executeCommand('cmd.gated')).toEqual(COMMAND_CLOSED)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('answers close for a command nobody registered', async () => {
    expect(await executeCommand('cmd.absent')).toEqual(COMMAND_CLOSED)
  })

  it('rejects rather than throwing, whichever way the leaf failed', async () => {
    // Both spellings become a rejection. Every caller writes `.catch`, and a synchronous throw used
    // to go straight past all of them into the key dispatcher.
    register(leaf('cmd.throws', { run: () => { throw new Error('nope') } }))
    register(leaf('cmd.rejects', { run: () => Promise.reject(new Error('later')) }))
    await expect(executeCommand('cmd.throws')).rejects.toThrow('nope')
    await expect(executeCommand('cmd.rejects')).rejects.toThrow('later')
  })

  it('does not run an interactive command, because entering one is not running it', async () => {
    register({ id: 'cmd.group', title: 'Panes', category: 'pane', palette: true, kind: 'group' })
    expect(await executeCommand('cmd.group')).toEqual({ effect: 'stay' })
  })
})

describe('the union', () => {
  it('reads a registration with no kind as the leaf it has always been', () => {
    const command = register(leaf('cmd.plain'))
    expect(command.kind).toBeUndefined()
    expect(isActionCommand(command)).toBe(true)
    expect(isActionCommand({ id: 'g', title: 'g', category: 'pane', kind: 'group' })).toBe(false)
  })

  it('stamps an owner over whatever arrived, because the owner is the host’s word', () => {
    const stamped = stampCommandOwner(leaf('cmd.owned'), 'board')
    expect(stamped.ownerId).toBe('board')
  })

  it('registers a batch and takes the whole batch back out', () => {
    const disposable = registerCommands([leaf('cmd.one'), leaf('cmd.two')])
    expect(commandRegistry.get('cmd.one')).toBeDefined()
    disposable.dispose()
    expect(commandRegistry.get('cmd.one')).toBeUndefined()
    expect(commandRegistry.get('cmd.two')).toBeUndefined()
  })
})

describe('the command span', () => {
  let posted: TelemetryRecord[]
  const collecting = () => {
    posted = []
    startClientTelemetry({ runtime: 'renderer', post: async (records) => void posted.push(...records) })
    setTelemetryEnabled(true)
  }
  const spans = () => posted.filter((record) => record.kind === 'span' && record.name === 'command')

  afterEach(() => _resetClientTelemetry())

  it('names the command and the owner the registry stamped', async () => {
    collecting()
    register(stampCommandOwner(leaf('cmd.spanned'), 'workflows') as CommandContribution)
    await executeCommand('cmd.spanned')
    await flushTelemetry()
    const [span] = spans()
    expect(span.attrs).toMatchObject({ 'command.id': 'cmd.spanned', owner: 'workflows', runtime: 'renderer' })
    expect(span.kind === 'span' && span.status).toBe('ok')
  })

  it('files a core command under core', async () => {
    collecting()
    register(leaf('cmd.core'))
    await executeCommand('cmd.core')
    await flushTelemetry()
    expect(spans()[0]?.attrs.owner).toBe('core')
  })

  it('takes its status from the outcome, so a command that threw reads as one', async () => {
    collecting()
    register(leaf('cmd.throws', { run: () => { throw new Error('nope') } }))
    await expect(executeCommand('cmd.throws')).rejects.toThrow('nope')
    await flushTelemetry()
    const [span] = spans()
    expect(span.kind === 'span' && span.status).toBe('error')
  })

  it('waits for a command that returns a promise', async () => {
    collecting()
    let settle = () => {}
    register(leaf('cmd.slow', { run: () => new Promise<void>((resolve) => { settle = resolve }) }))
    const running = executeCommand('cmd.slow')
    await flushTelemetry()
    // Nothing yet: the command has not finished, so there is no duration to report.
    expect(spans()).toEqual([])
    settle()
    await running
    await flushTelemetry()
    expect(spans()).toHaveLength(1)
  })

  it('records nothing for a command that does not exist', async () => {
    collecting()
    await executeCommand('cmd.absent')
    await flushTelemetry()
    expect(spans()).toEqual([])
  })
})
