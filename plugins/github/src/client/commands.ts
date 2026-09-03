import type { CommandSearchItem } from '@acorn/protocol/commands.ts'
import {
  COMMAND_CLOSED,
  fuzzyScore,
  readJson,
  setSelectedSource,
  type CommandExecutionContext,
  type CommandOutcome,
  type ContributedCommand,
} from '@acorn/plugin-api/client'
import { pullsRoute, type Pull, type PullFile } from '../shared/api'
import { filterPulls } from './pullList/model'
import { githubBrowsePath, githubCreateRoute } from './clientRoutes'

// This plugin's router-scoped commands, as a function of what the router says.
//
// Built here rather than written inside the component that mounts them (./Shortcuts.tsx) for the
// reason ./pullList/model.ts and ./pullDetail/model.ts exist: a decision worth testing should not need
// a DOM to reach. The component supplies eight accessors and owns nothing else.
//
// **The file finder was an overlay until 2026-09-03.** A second command-palette-shaped dialog with its
// own query, cursor, key handling and list, opened on `/`. It is a `search` command on the shared
// session now, so `/` opens the one palette at its frame
// (client-core/host/registries/commands/presenter.ts). The chord, its typing exemption, the route gate,
// the ranking, the pull request's file order and the `?file=` selection are all unchanged; what moved
// is who owns the dialog.
//
// **Why these are not registered through `ctx.commands`.** Every one of them needs the router: which
// project is routed, which pull request is open, and where to navigate. A plugin's `init` runs at boot
// with no router in scope. They are consequently core-owned per-mount registrations at the root rather
// than a github-owned group, because a group would have to be registered from the same place to be
// parentable at all (docs/command-palette-and-shortcuts.md § What the palette refuses). The one
// command here that needs no router — the rail source — is in ./index.ts through `ctx`.

/** At most this many pull requests reach the palette. The host caps a search at 50 anyway; saying it
 *  here is the provider keeping its own promise (docs/command-palette-and-shortcuts.md
 *  § Search implementation notes). */
export const MAX_PULL_ROWS = 50

export type GithubCommandDeps = {
  /** The pull request on screen, or `null` when none is. The gate on all four PR commands. */
  route: () => { owner: string; repo: string; number: string } | null
  /** The routed repository, or `undefined` when the routed project has none. */
  github: () => { owner: string; name: string } | null | undefined
  projectId: () => string | undefined
  /** This pull request's changed files, in the order the diff lists them. */
  files: () => PullFile[]
  /** Writes `?file=`, which is what makes the pick outlive the palette closing. */
  selectFile: (path: string) => void
  cycleFile: (direction: 1 | -1) => void
  navigate: (to: string) => void
  openShortcuts: () => void
}

/** Filename first, then the directory that holds it: the name is what somebody typed and the path is
 *  how they tell two of them apart. Both renderers draw `subtitle` muted after the label, which is what
 *  the overlay's own row did by hand. */
const fileItem = (path: string): CommandSearchItem => {
  const slash = path.lastIndexOf('/')
  return {
    id: path,
    title: slash >= 0 ? path.slice(slash + 1) : path,
    ...(slash >= 0 ? { subtitle: path.slice(0, slash) } : {}),
    ref: path,
  }
}

const pullPath = (projectId: string, number: number): string => `${githubBrowsePath(projectId)}/${number}`

export function githubCommands(deps: GithubCommandDeps): ContributedCommand[] {
  /** One list of the routed repository's open pull requests per palette session, so typing costs
   *  nothing after the frame opens. Keyed on the captured context, which is one object per session, so
   *  a session opened over another project lists that project. */
  const pulls = new WeakMap<CommandExecutionContext, Promise<Pull[]>>()
  const openPulls = (context: CommandExecutionContext): Promise<Pull[]> => {
    const cached = pulls.get(context)
    if (cached) return cached
    const repo = deps.github()
    if (!repo) return Promise.resolve([])
    const pending = readJson<Pull[]>(pullsRoute(repo.owner, repo.name, 'open'))
    pulls.set(context, pending)
    // A failed read is not kept: Enter on the failure asks again rather than replaying it.
    void pending.catch(() => pulls.delete(context))
    return pending
  }

  return [
    // Not in the palette: the shortcut reference is a Settings page, and the palette already has a row
    // that opens Settings.
    { id: 'help.shortcuts.open', title: 'Open keyboard shortcuts', category: 'navigation', run: deps.openShortcuts },
    {
      id: 'github.files.find',
      kind: 'search',
      title: 'Find file in this pull request',
      hint: 'the files this pull request changed',
      category: 'navigation',
      palette: true,
      when: () => !!deps.route(),
      placeholder: 'Find file…',
      // The list is already in this window, fetched by the pull request on screen, so there is nothing
      // for a debounce to wait for and an empty query is the whole list in the diff's order.
      minQueryLength: 0,
      debounceMs: 0,
      // Ranked over the whole path with the palette's own scorer, the way the overlay ranked it: every
      // query character in order, contiguous runs and word starts scoring higher, ties keeping the pull
      // request's file order. The row splits the path for display only, which is why the score is not
      // taken over the halves — `client/App` spans the join.
      query: (text) => {
        const list = deps.files()
        const query = text.trim()
        if (!query) return Promise.resolve(list.map((file) => fileItem(file.path)))
        return Promise.resolve(list
          .map((file, at) => ({ file, at, score: fuzzyScore(query, file.path) }))
          .filter((row): row is { file: PullFile; at: number; score: number } => row.score !== null)
          .sort((a, b) => b.score - a.score || a.at - b.at)
          .map((row) => fileItem(row.file.path)))
      },
      select: (item): CommandOutcome => {
        if (!item.ref) return COMMAND_CLOSED
        if (!deps.files().some((file) => file.path === item.ref)) throw new Error('that file is no longer in this pull request')
        deps.selectFile(item.ref)
        return COMMAND_CLOSED
      },
    },
    { id: 'github.files.next', title: 'Next changed file', category: 'navigation', when: () => !!deps.route(), run: () => deps.cycleFile(1) },
    { id: 'github.files.previous', title: 'Previous changed file', category: 'navigation', when: () => !!deps.route(), run: () => deps.cycleFile(-1) },
    {
      id: 'github.pull.find',
      kind: 'search',
      title: 'Find pull request',
      hint: 'the open pull requests of the routed repository',
      keywords: ['pr', 'pull request'],
      category: 'navigation',
      palette: true,
      // Project-scoped: the list belongs to the repository the reader is looking at, and there is no
      // fleet or workspace query behind it to widen it to.
      scope: 'project',
      when: () => !!deps.github(),
      placeholder: 'Find a pull request…',
      minQueryLength: 0,
      debounceMs: 0,
      query: async (text, context) => {
        const list = await openPulls(context)
        // The browse list's own matcher, so the palette finds a pull request by the same words the
        // filter box does: its number, its title and its author.
        return filterPulls(list, text).slice(0, MAX_PULL_ROWS).map((pull): CommandSearchItem => ({
          id: String(pull.number),
          title: pull.title,
          subtitle: `#${pull.number}${pull.author ? ` · ${pull.author}` : ''}`,
          ...(pull.draft ? { badge: 'draft' } : {}),
          ref: String(pull.number),
        }))
      },
      select: (item, context): CommandOutcome => {
        const projectId = context.projectId ?? deps.projectId()
        if (!projectId || !item.ref) return COMMAND_CLOSED
        // The rail source first, then the route: the shell draws from the selected source rather than
        // from the location, so navigating alone moves the address bar and leaves the previous surface
        // on screen (client-core/host/registries/panes/contentLinks.ts § the route rung).
        setSelectedSource('github')
        deps.navigate(pullPath(projectId, Number(item.ref)))
        return COMMAND_CLOSED
      },
    },
    {
      id: 'github.pull.create',
      title: 'Create pull request',
      hint: 'open the create form for the routed repository',
      category: 'navigation',
      // In the palette now as well as on `c`, which is what the catalogue admitted it for. The route it
      // opens is the existing form, unchanged.
      palette: true,
      when: () => !!deps.projectId() && !!deps.github(),
      run: () => deps.navigate(githubCreateRoute.replace(':projectId', encodeURIComponent(deps.projectId() ?? ''))),
    },
  ]
}
