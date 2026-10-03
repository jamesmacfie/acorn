# Terminal host switch

This page covers how client-core boots under Node, which platform groups the terminal installs, the
build aliases that make a pane draw in cells, and the router stand-in. Read it before you add an
import a pane reaches, or a platform group. It's part of [the terminal client](../tui.md).

## Booting client-core under Node

The client reads its host through one seam, `packages/client-core/src/infra/platform/`, which reads
`window.acorn`, and nothing outside that folder may name the global. The seam checks `typeof window`,
so a Node host defines `window` as an object holding `acorn` and nothing else. A `window` that answered
every question would be worse, because libraries probe it for `addEventListener` and `localStorage`
and would find the process's globals instead.

`main.tsx` installs the seam and then imports the rest dynamically, because a module that reads
`window.acorn` at its top level would read it before the install.

There's one query client per Node. `App.tsx` takes `clientFor(nodeId).client` as a prop, the same
client `watchTaskChanges` invalidates and the persister writes. Nothing on any host may add a second
client ([caching](../caching.md) § Renderer query cache).

The roster and the loaded-plugin worker factory load after the first frame.
`apps/tui/src/roster.ts` holds the 12 client plugins. `main.tsx` imports it and the worker factory on
the renderer's first `frame` event, then installs the factory before starting the loaded-plugin
watcher. Every contribution registry is a Solid signal, so the chrome draws first and the rail, pane
strip, and palette fill in as plugins register. The four host seams in `App.tsx`, the layout table
above all, stay eager, because a pane needs them before it can draw.

Production JavaScript is minified with Oxc. Zod stays bundled so unused exports can be removed. The
startup budget counts the launcher, every import awaited before rendering, and the `App` closure
([frontend](../frontend/startup-budget.md) § Startup budget). Custody imports Node-core leaf entrypoints only, and
the package installer loads only when a device plugin is installed, which keeps database and
plugin-loader code out of the first frame. The remote-tree component loads when an accepted plugin
renders a tree.

### Platform groups

The terminal installs these platform groups:

| Group | What the terminal installs |
| --- | --- |
| `transport` | `NodeBroker`, in process. Responses stay buffered `Uint8Array`. |
| `fleet` | The fleet store: `list`, `probe`, `pair`, `rename`, `forget`, `reconnect`, `restartLocal`. `nodeAdopt` and tunnels aren't installed. |
| `pairing` | Probe only. The seam remembers the probe, so confirming a fingerprint is a step a caller can't skip. |
| `plugins` | File-backed custody ([loaded plugins](./plugins.md#custody)). |
| `files` | A path prompt reads local bytes for attachments and writes exports locally. It needs an absolute path, rejects attachments over the Agent route's 10 MiB limit before reading, reports errors, and confirms before replacing a file. The Node never sees the local path. |
| `recovery` | `openDataFolder` prints the path, and `quit` exits. |
| `desktop`, `desktopExtras`, `folderPicker`, `preview`, `webviews` | Absent. The controls they gate disappear. |

## The host switch

An alias list in `apps/tui/vite.config.ts`, mirrored in the package's `tsconfig.json` paths, makes a
compiled pane draw in cells. Keep both in step, or `tsc` and the bundle disagree silently:

- `@acorn/plugin-api/ui` resolves to `apps/tui/src/kit/ui.ts`, this package's kit.
- `@acorn/plugin-api/ui/host` resolves to `apps/tui/src/kit/host.tsx`: the palette chrome, the drawer,
  the reference-panel box, and the two cooperative-extension nodes.
- `@acorn/plugin-api/ui/editor` resolves to `apps/tui/src/kit/editor.ts`. It exports the facade's
  names with its types: `languageForPath` resolves to no extension, theme accessors return nothing,
  and view-state helpers do nothing. The `editor` rectangle draws the file and hands `$EDITOR` a PTY
  ([the editor pane](../editor/editor-pane.md) § Editing in your own editor).
- `@solidjs/router` is replaced by a path in a signal ([the router](#the-router)). The package reads
  `window.history.state` at module scope, so it can't load in this process.
- `solid-js` points at the client build, because Solid's `node` condition is its server renderer and
  has no reactivity.
- Three stubs stand in front of packages this host doesn't install: CodeMirror's grammars and
  highlight styles, browser xterm and its addons, and Shiki
  (`apps/tui/src/kit/codemirrorGrammars.ts`, `apps/tui/src/kit/xterm.ts`, and
  `apps/tui/src/kit/shiki.ts`). Every export throws and names the host. Each stub is a pattern, so a
  language added to client-core doesn't become a package this host has to install. Two specifiers
  stay real: `@xterm/headless`, the `pty` rectangle's emulator, and `@codemirror/language`, which
  `codemirror` depends on. A stub may only stand in front of a specifier no working view reaches.
- `lucide-static/icon-nodes.json` resolves to an empty table. It's 706 KB of SVG path data, and the
  terminal kit draws a small set of `Icon` names as one-cell glyphs (`apps/tui/src/kit/glyphs.ts`).
  Other names draw nothing.

The last alias also prevents a crash. The bundle externalizes every bare import from outside the
workspace, and Node's loader refuses a JSON module without `with { type: 'json' }`. The TypeScript
transform drops that attribute, so a JSON import anywhere in the graph throws
`ERR_IMPORT_ATTRIBUTE_MISSING` from a lazy chunk, the first time someone opens the view that pulls it.
If another appears, alias it or inline it. Search `apps/tui/dist` for `from "….json"` to find one.

Two build facts sit beside the aliases. `vite-plugin-solid` with `generate: 'universal'` sends JSX to
`apps/tui/src/tree/renderer.ts`, named by path. And `__ACORN_HOST__` is `'tui'`, which `Only` and
`Fallback` read. It's the only place the kit asks which host it's on
([the closed kit](../ui-design/closed-kit.md)).

`apps/tui/src/tree/renderer.ts` is all that Solid drives: the 10 node operations `solid-js/universal`
asks for, over the plain objects in `apps/tui/src/tree/node.ts`, plus `render` and `Dynamic`. Every
JSX call in the process lands there, client-core's and a sandboxed plugin's included.

Anything that touches Solid's reactive graph is bundled, so there's exactly one copy. A second copy
is a second graph, and it fails as "No renderer found" from inside a component that's under the
provider.

## The router

`apps/tui/src/kit/router.ts` is one module-level path signal and the five hooks a pane asks for. It
matches with client-core's `matchRoute`, against core's three patterns and every pattern a source
contributed, so both hosts agree on what `/p/:projectId/pulls/:number` means. A browse view carries
its project and open item in the path, so the GitHub view reads `params.projectId`, and its list opens
a pull request by navigating to it.

Three details matter:

- `useParams` returns a proxy, not an object. Callers read a field inside a derivation, so the
  reactivity has to be in the property access.
- Order decides a match. Core's patterns come first, then contributed ones in declared order, which
  `sourceRouteContributions` sorts. That puts `/p/:id/pulls/new` before `/p/:id/pulls/:number`.
- There's no query string. Views that keep state in the query on the desktop pass `router: false`
  here.

What a path means is in `apps/tui/src/chrome/routing.ts`: open the task a path names, move the rail
to the source that claims it, and keep the path on a project the workspace has. The router is aliased
as `@solidjs/router` and every plugin imports it, so it mustn't reach into the chrome.
