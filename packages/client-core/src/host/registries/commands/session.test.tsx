import { createRoot, createSignal } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommandSearchItem } from '@acorn/protocol/commands.ts'
import type { Disposable } from '../../../kit/lib/registry'
import {
  commandRegistry,
  executeCommand,
  type CommandContribution,
  type CommandExecutionContext,
  type CommandOutcome,
  type InputCommand,
  type SearchCommand,
} from './commands'
import {
  createCommandSession,
  type CommandFleetNode,
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
  options: {
    providers?: readonly SessionRowProvider[]
    fleet?: readonly CommandFleetNode[]
    context?: CommandExecutionContext
  } = {},
): Promise<void> {
  const [context, setContext] = createSignal(options.context ?? CONTEXT)
  let closes = 0
  let opens = 0
  let session!: CommandSession
  const dispose = createRoot((disposeRoot) => {
    session = createCommandSession({
      context,
      providers: () => options.providers ?? [],
      ...(options.fleet ? { fleet: () => options.fleet! } : {}),
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

// ── Search and input (docs/future/command-palette/phase-2-search-and-input.md § Tests) ────────────
//
// Two rules run through all of it. A query is asked once the typing stops and only for the last thing
// typed, and an answer is applied only if the frame still wants it — which is the generation, not the
// abort, because a provider is free to ignore a signal and some of them do.

const item = (id: string, over: Record<string, unknown> = {}): CommandSearchItem =>
  ({ id, title: id, ...over }) as CommandSearchItem

const search = (id: string, over: Partial<SearchCommand>): CommandContribution => ({
  id, title: id, category: 'action', palette: true, kind: 'search',
  query: async () => [], select: () => {}, ...over,
} as CommandContribution)

const input = (id: string, over: Partial<InputCommand>): CommandContribution => ({
  id, title: id, category: 'action', palette: true, kind: 'input',
  submit: () => {}, ...over,
} as CommandContribution)

const labels = (session: CommandSession): string[] => session.rows().map((row) => row.label)

/** Fake timers plus the microtasks a settled promise needs. `advanceTimersByTimeAsync` awaits between
 *  timers, so one call covers both a debounce and the fetch it started. */
const tick = async (ms = 0): Promise<void> => { await vi.advanceTimersByTimeAsync(ms) }

describe('a search frame', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('asks once when the typing stops, and only for the last thing typed', async () => {
    const asked: string[] = []
    register(search('find', { query: async (text) => { asked.push(text); return [item('issue-1')] } }))
    await withSession(async (session) => {
      session.openAt('find')
      session.setQuery('r')
      session.setQuery('ro')
      session.setQuery('rol')
      await tick(1_000)
      expect(asked).toEqual(['rol'])
      expect(labels(session)).toEqual(['issue-1'])
    })
  })

  it('says what it wants until the query is long enough, and asks for it trimmed', async () => {
    const asked: string[] = []
    register(search('find', { query: async (text) => { asked.push(text); return [] } }))
    await withSession(async (session) => {
      session.openAt('find')
      expect(labels(session)).toEqual(['Type at least 2 characters to search.'])
      session.setQuery('  r  ')
      await tick(1_000)
      expect(asked).toEqual([])
      expect(labels(session)).toEqual(['Type at least 2 characters to search.'])

      session.setQuery('  ro  ')
      await tick(1_000)
      expect(asked).toEqual(['ro'])
    })
  })

  it('waits for the composition to end before asking, so an IME costs one request', async () => {
    const asked: string[] = []
    register(search('find', { query: async (text) => { asked.push(text); return [] } }))
    await withSession(async (session) => {
      session.openAt('find')
      session.setComposing(true)
      session.setQuery('にほ')
      session.setQuery('にほん')
      await tick(1_000)
      expect(asked).toEqual([])

      session.setComposing(false)
      await tick(1_000)
      expect(asked).toEqual(['にほん'])
    })
  })

  it('gives up on what it asked when the query, the frame or the world moves', async () => {
    const signals: AbortSignal[] = []
    register(search('find', {
      query: (_text, _context, signal) => {
        signals.push(signal)
        return new Promise<CommandSearchItem[]>(() => {})
      },
    }))
    const held = signals

    await withSession(async (session) => {
      session.openAt('find')
      session.setQuery('rol')
      await tick(300)
      expect(held).toHaveLength(1)
      expect(held[0].aborted).toBe(false)

      // A new query.
      session.setQuery('roll')
      expect(held[0].aborted).toBe(true)
      await tick(300)
      expect(held).toHaveLength(2)

      // Escape out of the frame.
      session.back()
      expect(held[1].aborted).toBe(true)
    })

    held.length = 0
    await withSession(async (session) => {
      session.openAt('find')
      session.setQuery('rol')
      await tick(300)
      session.close()
      expect(held[0].aborted).toBe(true)
    })

    held.length = 0
    await withSession(async (session, world) => {
      session.openAt('find')
      session.setQuery('rol')
      await tick(300)
      // The task this session opened over moved, so the session closes and takes its request with it.
      world.setContext({ ...CONTEXT, taskId: 't-2' })
      await tick(0)
      expect(session.open()).toBe(false)
      expect(held[0].aborted).toBe(true)
    })
  })

  it('cannot be given an old answer by a provider that ignored its signal', async () => {
    let releaseFirst: (items: CommandSearchItem[]) => void = () => {}
    register(search('find', {
      query: (text) => text === 'ro'
        ? new Promise<CommandSearchItem[]>((resolve) => { releaseFirst = resolve })
        : Promise.resolve([item('new')]),
    }))
    await withSession(async (session) => {
      session.openAt('find')
      session.setQuery('ro')
      await tick(300)
      session.setQuery('rol')
      await tick(300)
      expect(labels(session)).toEqual(['new'])

      // The first request answers anyway, long after its query stopped being the question.
      releaseFirst([item('stale')])
      await tick(0)
      expect(labels(session)).toEqual(['new'])
    })
  })

  it('walks instruction, loading, empty, error, retry and pick', async () => {
    let answer: () => Promise<CommandSearchItem[]> = async () => []
    const picked: CommandSearchItem[] = []
    register(search('find', {
      query: () => answer(),
      select: (chosen) => { picked.push(chosen) },
    }))
    await withSession(async (session) => {
      session.openAt('find')
      expect(session.kind()).toBe('search')
      expect(labels(session)).toEqual(['Type at least 2 characters to search.'])

      // Loading: the debounce has fired and nobody has answered yet.
      let release: (items: CommandSearchItem[]) => void = () => {}
      answer = () => new Promise((resolve) => { release = resolve })
      session.setQuery('rol')
      await tick(300)
      expect(labels(session)).toEqual(['Searching…'])
      expect(session.busy()).toBe(true)

      // Empty.
      release([])
      await tick(0)
      expect(labels(session)).toEqual(['No results.'])
      expect(session.busy()).toBe(false)

      // Error, and it is not selectable: Enter on it is the retry.
      answer = () => Promise.reject(new Error('the node said no'))
      session.setQuery('roll')
      await tick(300)
      expect(labels(session)).toEqual(['search: the node said no'])
      expect(session.selectedRow()).toBeNull()

      answer = async () => [item('issue-1', { subtitle: 'runn/runn', badge: '12' })]
      session.activate()
      await tick(0)
      expect(labels(session)).toEqual(['issue-1'])
      expect(session.rows()[0]?.hint).toBe('runn/runn')
      expect(session.rows()[0]?.badge).toBe('12')

      session.activate()
      await tick(0)
      expect(picked.map((row) => row.id)).toEqual(['issue-1'])
      // A pick closes, which is what an action means.
      expect(session.open()).toBe(false)
    })
  })
})

describe('an input frame', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('submits once, on Enter, and never twice', async () => {
    const sent: string[] = []
    let release: () => void = () => {}
    register(input('ask', {
      submit: (text) => {
        sent.push(text)
        return new Promise<void>((resolve) => { release = () => resolve() })
      },
    }))
    await withSession(async (session) => {
      session.openAt('ask')
      expect(session.kind()).toBe('input')
      expect(labels(session)).toEqual(['Press Enter to submit.'])

      // Typing is not submitting: an input is never debounced into a request.
      session.setQuery('select 1')
      await tick(1_000)
      expect(sent).toEqual([])

      session.activate()
      expect(sent).toEqual(['select 1'])
      expect(labels(session)).toEqual(['Submitting…'])
      session.activate()
      expect(sent).toEqual(['select 1'])

      release()
      await tick(0)
      expect(session.open()).toBe(false)
    })
  })

  it('refuses what its own validation refuses, without asking anybody', async () => {
    const sent: string[] = []
    register(input('ask', {
      validate: (text) => (text.length < 4 ? 'say a little more' : undefined),
      submit: (text) => { sent.push(text) },
    }))
    await withSession(async (session) => {
      session.openAt('ask')
      session.setQuery('ab')
      session.activate()
      expect(sent).toEqual([])
      expect(session.status()).toBe('say a little more')

      session.setQuery('abcd')
      session.activate()
      await tick(0)
      expect(sent).toEqual(['abcd'])
    })
  })

  it('keeps the text and the frame when the submission fails, and the line when it stays', async () => {
    let answer: () => Promise<CommandOutcome> = async () => ({ effect: 'stay', status: 'wrote it' })
    register(input('ask', { submit: () => answer() }))
    await withSession(async (session) => {
      session.openAt('ask')
      session.setQuery('select 1')
      session.activate()
      await tick(0)
      expect(session.open()).toBe(true)
      expect(session.status()).toBe('wrote it')

      answer = () => Promise.reject(new Error('syntax error at or near "slect"'))
      session.activate()
      await tick(0)
      expect(session.open()).toBe(true)
      expect(session.query()).toBe('select 1')
      expect(session.status()).toBe('syntax error at or near "slect"')
    })
  })

  it('gives up on a submission the reader escaped out of', async () => {
    let signal!: AbortSignal
    let release: () => void = () => {}
    register(input('ask', {
      submit: (_text, _context, sent) => {
        signal = sent
        return new Promise<void>((resolve) => { release = () => resolve() })
      },
    }))
    await withSession(async (session) => {
      session.openAt('ask')
      session.setQuery('select 1')
      session.activate()
      session.back()
      expect(signal.aborted).toBe(true)
      // The answer arrives anyway and lands nowhere: the frame that asked is gone.
      release()
      await tick(0)
      expect(session.open()).toBe(true)
      expect(session.kind()).toBe('root')
    })
  })
})

describe('scope', () => {
  it('hides a command whose identity this session does not have', async () => {
    register(leaf('needs.task', { scope: 'task' }))
    register(leaf('needs.project', { scope: 'project' }))
    register(leaf('needs.workspace', { scope: 'workspace' }))
    register(leaf('needs.nothing', { scope: 'none' }))
    await withSession((session) => {
      session.openRoot()
      expect(ids(session)).toEqual(['needs.nothing'])
    }, { context: { ...CONTEXT, taskId: null, projectId: null, workspaceId: null } })

    await withSession((session) => {
      session.openRoot()
      expect(ids(session)).toEqual(['needs.task', 'needs.project', 'needs.workspace', 'needs.nothing'])
    })
  })

  it('will not open at a command the captured identity hides', async () => {
    register(leaf('needs.task', { scope: 'task' }))
    await withSession((session) => {
      session.openAt('needs.task')
      // The root, not the command: a shortcut aimed at something this session cannot run opens the
      // list rather than a frame that could only fail.
      expect(session.kind()).toBe('root')
      expect(ids(session)).toEqual([])
    }, { context: { ...CONTEXT, taskId: null } })
  })

  it('asks the captured node, and only fans out when a command says fleet', async () => {
    const asked: (string | null)[] = []
    register(search('here', { minQueryLength: 0, debounceMs: 0, query: async (_t, context) => { asked.push(context.nodeId); return [] } }))
    register(search('everywhere', {
      scope: 'fleet', minQueryLength: 0, debounceMs: 0,
      query: async (_t, context) => { asked.push(context.nodeId); return [] },
    }))
    await withSession(async (session) => {
      session.openAt('here')
      await settle()
      expect(asked).toEqual(['node-1'])

      asked.length = 0
      session.close()
      session.openAt('everywhere')
      await settle()
      expect(asked).toEqual(['node-1', 'node-2'])
    }, { fleet: [{ nodeId: 'node-1', label: 'laptop' }, { nodeId: 'node-2', label: 'desktop' }] })
  })

  it('keeps two nodes’ rows apart, and one node’s failure off the other’s rows', async () => {
    const chosen: { id: string; nodeId: string | null }[] = []
    register(search('everywhere', {
      scope: 'fleet', minQueryLength: 0, debounceMs: 0,
      query: async (_text, context) => {
        if (context.nodeId === 'node-2') throw new Error('no answer within 5s')
        return [item('dup')]
      },
      select: (picked, context) => { chosen.push({ id: picked.id, nodeId: context.nodeId }) },
    }))
    await withSession(async (session) => {
      session.openAt('everywhere')
      await settle()
      // The error first, then the rows the other node did answer with.
      expect(labels(session)).toEqual(['desktop: no answer within 5s', 'dup'])
      expect(ids(session)).toEqual(['error:desktop:0', 'node-1:dup'])
      expect(session.rows()[1]?.hint).toBe('laptop')

      session.activate()
      await settle()
      // Picked against the node that answered with it, not against whichever node is active.
      expect(chosen).toEqual([{ id: 'dup', nodeId: 'node-1' }])
    }, { fleet: [{ nodeId: 'node-1', label: 'laptop' }, { nodeId: 'node-2', label: 'desktop' }] })
  })

  it('does not let a search opened at directly cost the root its provider rows', async () => {
    // Opening straight at a search frame starts the providers' fetch and the frame's own in the same
    // tick. They have separate generations for exactly this: Escape comes back to a root with rows.
    register(search('find', { minQueryLength: 0, debounceMs: 0, query: async () => [] }))
    await withSession(async (session) => {
      session.openAt('find')
      await settle()
      session.back()
      expect(ids(session)).toEqual(['run:dev', 'find'])
    }, { providers: [provider('rows', 100, [{ id: 'run:dev', label: 'Run: dev' }])] })
  })

  it('namespaces a fleet row so two nodes answering with the same id are both reachable', async () => {
    register(search('everywhere', {
      scope: 'fleet', minQueryLength: 0, debounceMs: 0,
      query: async () => [item('dup')],
    }))
    await withSession(async (session) => {
      session.openAt('everywhere')
      await settle()
      expect(ids(session)).toEqual(['node-1:dup', 'node-2:dup'])
    }, { fleet: [{ nodeId: 'node-1', label: 'laptop' }, { nodeId: 'node-2', label: 'desktop' }] })
  })
})
