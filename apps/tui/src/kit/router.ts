// What `@solidjs/router` is on this host: one path in a signal, matched against the patterns the
// desktop's Router is built from.
//
// The third alias in the host switch, beside `@acorn/plugin-api/ui` and `@acorn/plugin-api/ui/host`
// (vite.config.ts). The first two swap a component for a component; this one replaces a package.
//
// The package itself still has to go, and for the reason it always did: `lifecycle.js` reads
// `window.history.state` at module scope, so importing it in this process throws before a line of
// ours runs. Answering that with a `history` on the platform seam's `window` is the failure that file
// warns about in its own header — a `window` that answers every question is worse than none, because
// the next library to probe it finds a browser's name over a Node process's globals.
//
// What changed is the second half of the old argument. This file used to say there was nothing behind
// the router to answer, so every hook returned this host's emptiness: no params, no match, and a
// navigation that did not happen. That was the right answer during the pane sweep, where an honest
// blank column beat a plausible wrong one. It stopped being the right answer when browse became a
// surface a reader drives from the shell, because a browse surface carries its project and its
// selected item in the path and nowhere else: `plugins/github/src/client/GithubBrowse.tsx` reads
// `params.projectId` to decide it has a repository at all, and `PullList` opens a pull by navigating
// to it. With an inert shim under them both, the GitHub surface in a terminal drew "Select a project"
// forever.
//
// So the path is real and the matching is shared. `matchRoute` is client-core's, the same function
// the source registry resolves a path with, so the two hosts cannot disagree about what
// `/p/:projectId/pulls/:number` means. What is still absent is the query string, below.
//
// Nothing here decides what a path *does*. Activating a task, or moving the rail to the source that
// owns a path, is the shell's reading of it and lives in ../chrome/routing.ts, the same separation
// ../keys/regions.ts keeps when it takes a pane cycler rather than importing the shell.

import { createSignal, type Accessor } from 'solid-js'
import {
  CREATE_TASK_ROUTE, PROJECT_ROUTE, TASK_ROUTE,
} from '@acorn/client-core/host/registries/commands/corePaths.ts'
import { matchRoute, sourceRouteContributions } from '@acorn/client-core/host/registries/sources/sources.ts'
import { projectSurfaceRoutes } from '@acorn/client-core/host/registries/panes/projectSurfaces.ts'

/** The DOM router's options object, so a caller's type still resolves. Nothing reads it. */
export type NavigateOptions = {
  resolve?: boolean
  replace?: boolean
  scroll?: boolean
  state?: unknown
}

const [path, setPath] = createSignal('/')

/** Where the shell is, as a path. Read by ../chrome/routing.ts, which is the only thing that acts on it. */
export const currentPath = path

/** Core's patterns ahead of the contributed ones, and the contributed ones in the order they were
 *  declared, which `sourceRouteContributions` already sorts. Order is what puts `/p/:id/pulls/new`
 *  in front of `/p/:id/pulls/:number`, so a static segment is tried before a parameter that would
 *  swallow it — the same reason `SourceRouteContribution` carries an `order` at all.
 *
 *  Both contributed tables, not one. A descriptor plugin's surface registers its pattern with
 *  `projectSurfaceRegistry` rather than as a source route — the desktop mounts those as `<Route>`s of
 *  their own (apps/desktop/src/client/index.tsx) — and this host had only the source half. So a Linear
 *  or Rollbar row navigated to a path nothing here could match: the surface got no item, and the
 *  shell's own "keep the path on a project this workspace has" effect saw a path with no project in it
 *  and navigated away from what the reader had just chosen (../chrome/routing.ts). */
const patterns = (): string[] => [
  CREATE_TASK_ROUTE,
  PROJECT_ROUTE,
  TASK_ROUTE,
  ...sourceRouteContributions().map((route) => route.path),
  ...projectSurfaceRoutes().map((route) => route.path),
]

/** The parameters the current path carries. Recomputed per read rather than memoised: this module has
 *  no reactive root to own a memo, and the work is a handful of string splits. */
const params = (): Record<string, string> => {
  const here = path()
  for (const pattern of patterns()) {
    const matched = matchRoute(pattern, here)
    if (matched) return matched
  }
  return {}
}

/** Go somewhere. A number is ignored: there is no history stack here, and a caller asking to go back
 *  is a caller the shell's own overlays and rail already answer. */
export const useNavigate = (): ((to: string | number, options?: NavigateOptions) => void) =>
  (to) => { if (typeof to === 'string') setPath(to) }

/**
 * The routed parameters.
 *
 * A proxy rather than a plain object, and that is load-bearing. Every caller reads a field inside a
 * memo — `GithubBrowse` does `const params = useParams()` once and then `params.projectId` in three
 * derivations — so the reactivity has to be in the property read. An object built at call time would
 * resolve once and never change again, which is the shim's old behaviour wearing a better disguise.
 */
export const useParams = <T extends Record<string, string>>(): T => new Proxy({} as T, {
  get: (_target, key) => (typeof key === 'string' ? params()[key] : undefined),
  has: (_target, key) => typeof key === 'string' && key in params(),
  ownKeys: () => Object.keys(params()),
  getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true, value: undefined }),
}) as T

/**
 * The query string, as the router's read/write pair. Still empty and still inert.
 *
 * Carrying it would be a few more lines, and no caller needs them: the surfaces that keep view state
 * in the query on the desktop already pass `router: false` here and keep it in a signal, and the
 * new-pull form reads its base and head from a client-local draft with the URL only overriding it
 * (docs/github-integration.md). Left undone on purpose rather than by omission — the day a pane needs
 * it, the path signal above is where it goes.
 */
export function useSearchParams<T extends Record<string, string | string[]>>(): [
  Partial<T>,
  (values: Partial<Record<keyof T, string | number | boolean | null | undefined>>, options?: NavigateOptions) => void,
] {
  return [{}, () => {}]
}

/** "Is the reader on this path", against one pattern rather than the whole table. Truthy when it
 *  matches, because that is all any caller does with it: `useMatch(() => githubCreateRoute)` becomes
 *  `!!newMatch()`. */
export const useMatch = (pattern: () => string): Accessor<{ path: string; params: Record<string, string> } | undefined> =>
  () => {
    const here = path()
    const matched = matchRoute(pattern(), here)
    return matched ? { path: here, params: matched } : undefined
  }

/** Test seam. Module state outlives a render, so a suite must not inherit the previous one's path.
 *  Beside `_resetChrome` and `_resetRegions`, and reset in the same place they are. */
export function _resetRouter(): void {
  setPath('/')
}
