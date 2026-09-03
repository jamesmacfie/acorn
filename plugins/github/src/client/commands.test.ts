import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommandExecutionContext, ContributedCommand, SearchCommand } from '@acorn/plugin-api/client'
import type { Pull, PullFile } from '../shared/api'

const mocks = vi.hoisted(() => ({ readJson: vi.fn(), setSelectedSource: vi.fn() }))
vi.mock('@acorn/plugin-api/client', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  readJson: mocks.readJson,
  setSelectedSource: mocks.setSelectedSource,
}))

import { githubCommands, type GithubCommandDeps } from './commands'

// The two searches that replaced this plugin's private file finder, and the two commands beside them.
// What is pinned is what the overlay guaranteed: the ranking is over the whole path, an empty query is
// the pull request's own file order, picking one writes `?file=`, and every PR command is gated on a
// pull request actually being open.

const file = (path: string): PullFile => ({ path, status: 'modified', additions: 1, deletions: 0, sha: null, viewed: false, patch: null })

const pull = (number: number, title: string, author: string | null = 'ada', draft = false): Pull => ({
  number, title, state: 'open', draft, author, headRef: null, baseRef: null,
  updatedAt: null, mergeable: null, mergeStateStatus: null, autoMergeEnabled: false,
})

const context = (projectId: string | null): CommandExecutionContext => ({
  host: 'desktop', nodeId: 'node-1', workspaceId: 'w-1', projectId, taskId: null, paneId: null, surfaceId: null,
})
const signal = (): AbortSignal => new AbortController().signal

let deps: GithubCommandDeps
let commands: ContributedCommand[]
const spies = {
  selectFile: vi.fn(), cycleFile: vi.fn(), navigate: vi.fn(), openShortcuts: vi.fn(),
}
const at = (id: string): ContributedCommand => commands.find((command) => command.id === id)!
const search = (id: string): SearchCommand => at(id) as SearchCommand
const runAction = (id: string): void => void (at(id) as { run: (context: CommandExecutionContext) => void }).run(context('project-1'))

beforeEach(() => {
  vi.clearAllMocks()
  deps = {
    route: () => ({ owner: 'runn-fast', repo: 'acorn', number: '42' }),
    github: () => ({ owner: 'runn-fast', name: 'acorn' }),
    projectId: () => 'project-1',
    files: () => [file('src/client/App.tsx'), file('src/node/boot.ts'), file('README.md')],
    ...spies,
  }
  commands = githubCommands(deps)
})

describe('the github plugin catalogue', () => {
  it('registers the five commands the chords name, and puts three of them in the palette', () => {
    expect(commands.map((command) => command.id)).toEqual([
      'help.shortcuts.open', 'github.files.find', 'github.files.next', 'github.files.previous',
      'github.pull.find', 'github.pull.create',
    ])
    expect(commands.filter((command) => command.palette).map((command) => command.id))
      .toEqual(['github.files.find', 'github.pull.find', 'github.pull.create'])
    // Every PR command is gone when no pull request is open, which is the gate the `/`, `[`, `]` and
    // `c` bindings carry as `active` too.
    deps.route = () => null
    deps.github = () => undefined
    const closed = githubCommands(deps)
    for (const id of ['github.files.find', 'github.files.next', 'github.files.previous', 'github.pull.find', 'github.pull.create']) {
      expect(closed.find((command) => command.id === id)!.when?.(), id).toBe(false)
    }
  })

  it('lists the changed files in the diff’s own order and splits the path for display', async () => {
    expect(await search('github.files.find').query('', context('project-1'), signal())).toEqual([
      { id: 'src/client/App.tsx', title: 'App.tsx', subtitle: 'src/client', ref: 'src/client/App.tsx' },
      { id: 'src/node/boot.ts', title: 'boot.ts', subtitle: 'src/node', ref: 'src/node/boot.ts' },
      { id: 'README.md', title: 'README.md', ref: 'README.md' },
    ])
  })

  it('ranks over the whole path, so a query that spans the join still matches', async () => {
    const rows = await search('github.files.find').query('client/App', context('project-1'), signal())
    expect(rows.map((row) => row.ref)).toEqual(['src/client/App.tsx'])
  })

  it('selecting a file writes ?file= through the changed-file store', async () => {
    const find = search('github.files.find')
    const rows = await find.query('boot', context('project-1'), signal())
    expect(find.select(rows[0], context('project-1'))).toEqual({ effect: 'close' })
    expect(spies.selectFile).toHaveBeenCalledWith('src/node/boot.ts')
  })

  it('refuses a file the pull request no longer changes', () => {
    expect(() => search('github.files.find').select({ id: 'gone.ts', title: 'gone.ts', ref: 'gone.ts' }, context('project-1')))
      .toThrow('no longer in this pull request')
    expect(spies.selectFile).not.toHaveBeenCalled()
  })

  it('finds a pull request by number, title or author, once per session', async () => {
    mocks.readJson.mockResolvedValue([pull(42, 'Fix the rail'), pull(7, 'Ship it', 'grace', true)])
    const world = context('project-1')
    const find = search('github.pull.find')
    expect(await find.query('', world, signal())).toEqual([
      { id: '42', title: 'Fix the rail', subtitle: '#42 · ada', ref: '42' },
      { id: '7', title: 'Ship it', subtitle: '#7 · grace', badge: 'draft', ref: '7' },
    ])
    expect((await find.query('grace', world, signal())).map((row) => row.ref)).toEqual(['7'])
    expect((await find.query('#42', world, signal())).map((row) => row.ref)).toEqual(['42'])
    expect(mocks.readJson).toHaveBeenCalledTimes(1)
    expect(mocks.readJson).toHaveBeenCalledWith('/v2/p/github/repos/runn-fast/acorn/pulls?state=open')
  })

  it('selects the rail source before navigating, because the shell draws from the source', async () => {
    mocks.readJson.mockResolvedValue([pull(42, 'Fix the rail')])
    const world = context('project-1')
    const find = search('github.pull.find')
    const rows = await find.query('', world, signal())
    expect(find.select(rows[0], world)).toEqual({ effect: 'close' })
    expect(mocks.setSelectedSource).toHaveBeenCalledWith('github')
    expect(spies.navigate).toHaveBeenCalledWith('/p/project-1/pulls/42')
  })

  it('creates a pull request through the existing form route', () => {
    runAction('github.pull.create')
    expect(spies.navigate).toHaveBeenCalledWith('/p/project-1/pulls/new')
  })

  it('cycles changed files without touching the palette', () => {
    runAction('github.files.next')
    runAction('github.files.previous')
    expect(spies.cycleFile).toHaveBeenNthCalledWith(1, 1)
    expect(spies.cycleFile).toHaveBeenNthCalledWith(2, -1)
  })
})
