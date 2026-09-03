import { afterEach, describe, expect, it, vi } from 'vitest'
import { composeItems, type PaletteItem } from '../../../kit/lib/paletteModel'
import type { Disposable } from '../../../kit/lib/registry'
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

// The command contract, as the two things a later phase will build on: what the palette will show,
// and what running one does.
//
// The first half is characterization. Every assertion below about discovery and composition is what
// the desktop (../../palette/CommandPalette.tsx) and the terminal (apps/tui/src/chrome/Palette.tsx)
// do today, written down so the shared session that replaces them can be held to it. If one of these
// changes, that is a product decision somebody made, not a refactor.
//
// One suite for both hosts, because the order is not either host's. Both build the action rows with
// the same registry filter and hand `composeItems` the same five sources, and that function owns what
// comes out (../../../kit/lib/paletteModel.ts). What the two hosts really do differ on — the desktop
// keys a task row by `${nodeId}:${taskId}` for its fleet fan-out and the terminal by the bare id — is
// below the composition and belongs to whichever renderer is still building rows.

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

describe('the rows both hosts compose', () => {
  it('orders errors, contributed rows, actions, workspaces and tasks', () => {
    register(leaf('cmd.archive', { title: 'Archive task' }))
    const rows: PaletteItem[] = [{ kind: 'run', id: 'run:dev', label: 'Run: dev', hint: 'pnpm dev', running: false }]
    const items = composeItems({
      rows,
      errors: [{ source: 'repo', message: 'run.bad is missing command' }],
      actions: paletteActions(),
      workspaces: [{ id: 'w-1', label: 'Switch workspace: Core' }],
      tasks: [{ id: 't-1', label: 'Go to task: fix login' }],
    })
    expect(items.map((item) => item.kind)).toEqual(['error', 'run', 'action', 'workspace', 'task'])
  })

  it('leaves an action row addressed by the command’s own id, unlike a task or a workspace', async () => {
    // Why a shortcut and a palette row reach one registration. A task row is `task:<id>` and a
    // workspace row is `workspace:<id>`, because those ids are only unique within their own kind; an
    // action row is the command id itself, which is also what a keybinding's `command` names
    // (./keybindings.ts) and what both key layers hand to `executeCommand`.
    const run = vi.fn()
    register(leaf('cmd.same', { run }))
    const items = composeItems({
      errors: [],
      actions: paletteActions(),
      workspaces: [{ id: 'w-1', label: 'Switch workspace: Core' }],
      tasks: [{ id: 't-1', label: 'Go to task: fix login' }],
    })
    expect(items.map((item) => item.id)).toEqual(['cmd.same', 'workspace:w-1', 'task:t-1'])
    // The palette's path and a shortcut's path, in that order, reaching the one registered leaf.
    await executeCommand(items[0].id)
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
