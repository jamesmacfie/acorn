// What `@solidjs/router` is on this host: nothing, said in the five names a pane asks for.
//
// The third alias in the host switch, beside `@acorn/plugin-api/ui` and `@acorn/plugin-api/ui/host`
// (vite.config.ts). The first two swap a component for a component; this one removes a package.
//
// Two reasons it has to go rather than be tolerated.
//
// The package is DOM-only in the hard sense: `lifecycle.js` reads `window.history.state` at module
// scope, so importing it in this process throws before a line of ours runs. Answering that with a
// `history` on the platform seam's `window` is the failure that file warns about in its own header —
// a `window` that answers every question is worse than none, because the next library to probe it
// finds a browser's name over a Node process's globals.
//
// And there is nothing behind it to answer. This host draws one shell with one pane in it and has no
// URL: the rail is a signal, a pane is the task's own layout, and a plugin's own routes are
// registered and never resolved. `RemoteTree` already spells the same answer for a loaded plugin —
// `navigate: () => {}`, with the pane and panel rungs of a content link resolving above it — and this
// is that answer for a compiled one. See docs/future/terminal/07-chrome.md § Navigation.
//
// So every hook here returns this host's truth rather than a plausible shape: no params, no query,
// nothing matched, and a navigation that does not happen. A pane that needed one of them to work
// would be a pane that cannot be driven from here at all, and the sweep would find it as a blank
// column rather than as a silent wrong answer.

import type { Accessor } from 'solid-js'

/** The DOM router's options object, so a caller's type still resolves. Nothing reads it. */
export type NavigateOptions = {
  resolve?: boolean
  replace?: boolean
  scroll?: boolean
  state?: unknown
}

/** Go somewhere. There is nowhere to go: what a pane would navigate *to* is reached here by the rail,
 *  the pane strip or the palette, all three of which are signals rather than URLs. */
export const useNavigate = (): ((to: string | number, options?: NavigateOptions) => void) => () => {}

/** The routed parameters. Always empty, because nothing here is routed — a pane is handed its task,
 *  and a surface that wants the workspace asks the shell's model for it. */
export const useParams = <T extends Record<string, string>>(): T => ({}) as T

/** The query string, as the router's read/write pair. Empty and inert: a caller that keeps view state
 *  in the URL on the desktop keeps it in a signal here, which is what every `router: false` call site
 *  in the github plugin already asks for. */
export function useSearchParams<T extends Record<string, string | string[]>>(): [
  Partial<T>,
  (values: Partial<Record<keyof T, string | number | boolean | null | undefined>>, options?: NavigateOptions) => void,
] {
  return [{}, () => {}]
}

/** "Is the reader on this path". Never, for the same reason `useParams` is empty. */
export const useMatch = (_path: () => string): Accessor<undefined> => () => undefined
