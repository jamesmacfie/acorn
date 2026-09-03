import { createRoot, createSignal } from 'solid-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Disposable } from '../../../kit/lib/registry'
import {
  commandRegistry,
  executeCommand,
  type CommandContribution,
  type CommandExecutionContext,
} from './commands'
import {
  createCommandSession,
  type CommandSession,
  type SessionRowProvider,
} from './session'

// The session's transitions, as one suite both hosts are held to.
//
// Every assertion here is a rule a reader can feel: what the empty root lists, what typing searches,
// what Enter does to a group, what Escape gives back, what happens when the thing you opened over
// moves. None of it mentions a dialog or a cell, which is the point — the desktop and the terminal
// bind keys and draw rows, and if one of them needed a different answer to any of these it would be
// two products (docs/future/command-palette/phase-1-command-graph-and-session.md § Tests).
//
// The DOM half is `../../palette/paletteView.test.tsx` and the terminal half is
// `apps/tui/src/chrome/chrome.test.tsx`; both drive the same operations through their own keys.

const held: Disposable[] = []
const register = (command: CommandContribution): void => {
  held.push(commandRegistry.register(command))
}

afterEach(() => {
  for (const disposable of held.splice(0).reverse()) disposable.dispose()
})

const group = (id: string, over: Partial<CommandContribution> = {}): CommandContribution => ({
  id, title: id, category: 'navigation', palette: true, kind: 'group', ...over,
} as CommandContribution)

const leaf = (id: string, over: Partial<CommandContribution> = {}): CommandContribution => ({
  id, title: id, category: 'action', palette: true, run: () => {}, ...over,
} as CommandContribution)

const CONTEXT: CommandExecutionContext = {
  host: 'desktop', nodeId: 'node-1', workspaceId: 'w-1', projectId: 'p-1', taskId: 't-1',
  paneId: null, surfaceId: null,
}

const provider = (id: string, order: number, rows: readonly { id: string; label: string }[], errors?: readonly { source: string; message: string }[]): SessionRowProvider => ({
  id,
  order,
  rows: () => ({
    rows: rows.map((row) => ({ ...row, action: { effect: 'run', run: () => {} } as const })),
    errors,
  }),
})

/** Everything queued has run: the providers answered and an activation's promise settled. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * One session, disposed after the body.
 *
 * The body runs *after* `createRoot` returns and not inside it, which matters: Solid flushes the
 * effects created in a root when the root's first pass finishes, so a body that ran inside would be
 * driving a session whose observer of the outside world had not started yet.
 */
async function withSession(
  body: (session: CommandSession, world: {
    setContext: (next: CommandExecutionContext) => void
    closes: () => number
    opens: () => number
  }) => void | Promise<void>,
  options: { providers?: readonly SessionRowProvider[] } = {},
): Promise<void> {
  const [context, setContext] = createSignal(CONTEXT)
  let closes = 0
  let opens = 0
  let session!: CommandSession
  const dispose = createRoot((disposeRoot) => {
    session = createCommandSession({
      context,
      providers: () => options.providers ?? [],
      onOpen: () => { opens += 1 },
      onClose: () => { closes += 1 },
    })
    return disposeRoot
  })
  try {
    await body(session, { setContext, closes: () => closes, opens: () => opens })
  } finally {
    dispose()
  }
}

const ids = (session: CommandSession): string[] => session.rows().map((row) => row.id)

describe('the empty root', () => {
  it('keeps the flat list’s order: errors, contributed rows, commands, workspaces, tasks', async () => {
    register(leaf('cmd.archive', { title: 'Archive task' }))
    await withSession(async (session) => {
      session.openRoot()
      await settle()
      expect(ids(session)).toEqual([
        'error:rows:0', 'run:dev', 'cmd.archive', 'workspace:w-2', 'task:t-2',
      ])
    }, {
      providers: [
        provider('rows', 100, [{ id: 'run:dev', label: 'Run: dev' }], [{ source: 'repo', message: 'run.bad is missing command' }]),
        provider('workspaces', 900, [{ id: 'workspace:w-2', label: 'Switch workspace: Core' }]),
        provider('tasks', 950, [{ id: 'task:t-2', label: 'Go to task: fix login' }]),
      ],
    })
  })

  it('lists top-level commands only, so a child is behind its group', async () => {
    register(group('panes', { title: 'Panes' }))
    register(leaf('panes.close', { title: 'Close pane', parentId: 'panes' }))
    await withSession((session) => {
      session.openRoot()
      expect(ids(session)).toEqual(['panes'])
    })
  })
})

describe('the typed root', () => {
  it('finds a descendant by its breadcrumb and shows the trail it came from', async () => {
    register(group('panes', { title: 'Panes' }))
    register(leaf('panes.close', { title: 'Close pane', parentId: 'panes' }))
    await withSession((session) => {
      session.openRoot()
      session.setQuery('panes close')
      const row = session.rows().find((candidate) => candidate.id === 'panes.close')
      // The whole point of nesting: hiding a command behind a group must not make it unfindable.
      expect(row).toBeDefined()
      expect(row?.breadcrumb).toEqual(['Panes'])
    })
  })

  it('interleaves commands with the compatibility rows by relevance, as one list', async () => {
    register(leaf('cmd.archive', { title: 'Archive task' }))
    await withSession(async (session) => {
      session.openRoot()
      await settle()
      session.setQuery('archive')
      // The contributed row sorts first when the query is empty and last when the query says so. A
      // reader who types a command's name should not have to scroll past every run target.
      // The row that came first is still in the list, just below: a query re-ranks the whole thing
      // rather than sorting each source's block on its own.
      expect(ids(session)).toEqual(['cmd.archive', 'run:rearchive'])
    }, { providers: [provider('rows', 100, [{ id: 'run:rearchive', label: 'Run: rearchive-old-logs' }])] })
  })

  it('keeps an error line visible whatever is typed, because it explains a missing row', async () => {
    await withSession(async (session) => {
      session.openRoot()
      await settle()
      session.setQuery('zzzz')
      expect(ids(session)).toEqual(['error:rows:0'])
      expect(session.selectedRow()).toBeNull() // visible, never the selection
    }, { providers: [provider('rows', 100, [{ id: 'run:dev', label: 'Run: dev' }], [{ source: 'repo', message: 'bad' }])] })
  })
})

describe('pushing and popping', () => {
  const nest = (): void => {
    register(group('a', { title: 'A' }))
    register(group('a.b', { title: 'B', parentId: 'a' }))
    register(group('a.b.c', { title: 'C', parentId: 'a.b' }))
    register(leaf('a.b.c.d', { title: 'D', parentId: 'a.b.c' }))
    register(leaf('a.other', { title: 'Other', parentId: 'a' }))
  }

  it('restores each parent’s query and cursor, three levels down and back', async () => {
    nest()
    await withSession((session) => {
      session.openRoot()
      session.setQuery('A')
      session.select('a')
      session.activate() // into A
      expect(session.breadcrumb()).toEqual(['A'])
      expect(ids(session)).toEqual(['a.b', 'a.other'])

      session.setQuery('other')
      session.setQuery('b') // the query A is left holding
      session.activate() // into B
      expect(session.breadcrumb()).toEqual(['A', 'B'])
      expect(ids(session)).toEqual(['a.b.c'])

      session.activate() // into C
      expect(ids(session)).toEqual(['a.b.c.d'])
      expect(session.breadcrumb()).toEqual(['A', 'B', 'C'])

      // Back up, one frame at a time, each landing on exactly what was left there.
      expect(session.back()).toBe(true)
      expect(session.frame()?.commandId).toBe('a.b')
      expect(session.selectedRow()?.id).toBe('a.b.c')
      expect(session.back()).toBe(true)
      expect(session.frame()?.commandId).toBe('a')
      expect(session.query()).toBe('b')
      expect(session.selectedRow()?.id).toBe('a.b')
      expect(session.back()).toBe(true)
      expect(session.frame()?.commandId).toBeNull()
      expect(session.query()).toBe('A')
      expect(session.selectedRow()?.id).toBe('a')
      expect(session.open()).toBe(true)
    })
  })

  it('closes at the root, and hands focus back only then', async () => {
    nest()
    await withSession((session, world) => {
      session.openRoot()
      session.select('a')
      session.activate()
      expect(session.back()).toBe(true)
      expect(world.closes()).toBe(0) // a pop is still inside the palette
      expect(session.back()).toBe(false)
      expect(session.open()).toBe(false)
      expect(world.closes()).toBe(1)
    })
  })
})

describe('availability', () => {
  it('hides a whole subtree when its ancestor is unavailable', async () => {
    const [open, setOpen] = createSignal(true)
    register(group('gated', { title: 'Gated', when: () => open() }))
    register(leaf('gated.child', { title: 'Child', parentId: 'gated' }))
    await withSession((session) => {
      session.openRoot()
      session.setQuery('child')
      expect(ids(session)).toEqual(['gated.child'])
      setOpen(false)
      // Not "the group is hidden and the child floats to the root": a child of a group you cannot
      // reach is not reachable either.
      expect(ids(session)).toEqual([])
    })
  })
})

describe('the cursor', () => {
  it('keeps the row it was on by id when the list is rebuilt under it', async () => {
    register(leaf('cmd.one', { title: 'One' }))
    register(leaf('cmd.two', { title: 'Two' }))
    await withSession((session) => {
      session.openRoot()
      session.select('cmd.two')
      expect(session.selectedIndex()).toBe(1)
      session.refresh()
      expect(session.selectedRow()?.id).toBe('cmd.two')
    })
  })

  it('clamps to the first selectable row when the one it was on is gone', async () => {
    const [both, setBoth] = createSignal(true)
    register(leaf('cmd.one', { title: 'One' }))
    register(leaf('cmd.two', { title: 'Two', when: () => both() }))
    await withSession((session) => {
      session.openRoot()
      session.select('cmd.two')
      setBoth(false)
      expect(session.selectedRow()?.id).toBe('cmd.one')
    })
  })

  it('steps over the rows that are not selectable and stops at both ends', async () => {
    register(leaf('cmd.one', { title: 'One' }))
    await withSession(async (session) => {
      session.openRoot()
      await settle()
      expect(ids(session)).toEqual(['error:rows:0', 'cmd.one'])
      expect(session.selectedRow()?.id).toBe('cmd.one') // never the error line
      session.move(-1)
      expect(session.selectedRow()?.id).toBe('cmd.one')
      session.move(1)
      expect(session.selectedRow()?.id).toBe('cmd.one')
    }, { providers: [provider('rows', 100, [], [{ source: 'repo', message: 'bad' }])] })
  })
})

describe('outcomes', () => {
  it('closes on a plain action, which is what every registration written before this meant', async () => {
    const run = vi.fn()
    register(leaf('cmd.go', { run }))
    await withSession(async (session) => {
      session.openRoot()
      session.activate()
      await settle()
      expect(run).toHaveBeenCalledWith(expect.objectContaining({ taskId: 't-1' }))
      expect(session.open()).toBe(false)
    })
  })

  it('stays open with the line a `stay` outcome carried', async () => {
    register(leaf('cmd.stay', { run: () => ({ effect: 'stay' as const, status: 'Saved' }) }))
    await withSession(async (session) => {
      session.openRoot()
      session.activate()
      await settle()
      expect(session.open()).toBe(true)
      expect(session.status()).toBe('Saved')
    })
  })

  it('keeps the frame open with the message when the command throws', async () => {
    register(leaf('cmd.bad', { run: () => { throw new Error('nope') } }))
    await withSession(async (session) => {
      session.openRoot()
      session.activate()
      await settle()
      // The error has to be somewhere a reader can see it, and that means the palette is still there.
      expect(session.open()).toBe(true)
      expect(session.status()).toBe('nope')
    })
  })

  it('ignores a second Enter while the first is still running', async () => {
    let calls = 0
    let release = (): void => {}
    register(leaf('cmd.slow', {
      run: () => new Promise<void>((resolve) => { calls += 1; release = () => resolve() }),
    }))
    await withSession(async (session) => {
      session.openRoot()
      session.activate()
      await settle()
      expect(session.busy()).toBe(true)
      session.activate()
      session.activate()
      expect(calls).toBe(1)
      release()
      await settle()
      expect(session.open()).toBe(false)
    })
  })
})

describe('the world moving underneath', () => {
  it('closes once when the task it captured changes on its own', async () => {
    register(leaf('cmd.one'))
    await withSession((session, world) => {
      session.openRoot()
      world.setContext({ ...CONTEXT, taskId: 't-2' })
      expect(session.open()).toBe(false)
      expect(world.closes()).toBe(1)
      world.setContext({ ...CONTEXT, taskId: 't-3' })
      expect(world.closes()).toBe(1)
    })
  })

  it('lets a command that navigates close through its own outcome instead', async () => {
    let move = (): void => {}
    await withSession(async (session, world) => {
      register(leaf('cmd.goto', {
        run: async () => {
          move()
          await Promise.resolve()
        },
      }))
      move = () => world.setContext({ ...CONTEXT, taskId: 't-9' })
      session.openRoot()
      session.activate()
      await settle()
      // One close, and it is the command's. The observer that watches the captured identity must not
      // race the outcome and shut the palette out from under an error it has not reported yet.
      expect(world.closes()).toBe(1)
      expect(session.open()).toBe(false)
    })
  })

  it('closes as soon as a command that moved the world settles without closing', async () => {
    await withSession(async (session, world) => {
      register(leaf('cmd.moves', {
        run: async () => {
          world.setContext({ ...CONTEXT, projectId: 'p-2' })
          await Promise.resolve()
          return { effect: 'stay' as const, status: 'done' }
        },
      }))
      session.openRoot()
      session.activate()
      await settle()
      // The observer waits for the command and then answers: it stayed open over a project it no
      // longer captured, so it is not a palette any more.
      expect(session.open()).toBe(false)
      expect(world.closes()).toBe(1)
    })
  })

  it('does not close because a pane or a surface moved', async () => {
    register(leaf('cmd.one'))
    await withSession((session, world) => {
      session.openRoot()
      world.setContext({ ...CONTEXT, paneId: 'pane-2', surfaceId: 'surface-2' })
      expect(session.open()).toBe(true)
    })
  })
})

describe('opening at a command', () => {
  it('opens a group at its own frame, which is what a shortcut aimed at one means', async () => {
    register(group('a', { title: 'A' }))
    register(group('a.b', { title: 'B', parentId: 'a' }))
    register(leaf('a.b.c', { title: 'C', parentId: 'a.b' }))
    await withSession((session) => {
      session.openAt('a.b')
      expect(session.open()).toBe(true)
      expect(session.breadcrumb()).toEqual(['A', 'B'])
      expect(ids(session)).toEqual(['a.b.c'])
      // The stack is real, so Escape walks back out through A to the root.
      expect(session.back()).toBe(true)
      expect(ids(session)).toEqual(['a.b'])
      expect(session.back()).toBe(true)
      expect(ids(session)).toEqual(['a'])
    })
  })

  it('opens a leaf at its parent with the cursor on it', async () => {
    register(group('a', { title: 'A' }))
    register(leaf('a.b', { title: 'B', parentId: 'a' }))
    await withSession((session) => {
      session.openAt('a.b')
      expect(session.frame()?.commandId).toBe('a')
      expect(session.selectedRow()?.id).toBe('a.b')
    })
  })

  it('is what `executeCommand` reaches for when a command has no executor', async () => {
    register(group('a', { title: 'A' }))
    register(leaf('a.b', { title: 'B', parentId: 'a' }))
    await withSession(async (session) => {
      // The keymap is still the only dispatcher: it hands a group's id to `executeCommand` exactly as
      // it does a leaf's, and this is what happens to it there.
      expect(await executeCommand('a')).toEqual({ effect: 'stay' })
      expect(session.open()).toBe(true)
      expect(session.frame()?.commandId).toBe('a')
    })
  })
})
