# Startup budget

This page covers the build checks on what the desktop renderer and the terminal client load before
they draw. Read it before you add an import that runs at startup, or when a build fails its budget.
It's part of [frontend](../frontend.md).

## Startup budget

Both clients have a build check over what they load before they draw. Each fails the build two ways:
over a byte ceiling, or on a denied chunk or module name.

### The renderer

`apps/desktop/scripts/check-renderer-budget.mjs` runs from `@acorn/desktop`'s `build`. It sums every
script and stylesheet a cold window loads, against ceilings of 760,000 B for scripts and 200,000 B for
styles. The script ceiling is about 5% above the measurement of 726,109 B on October 2, 2026, taken
after compiled plugin registration moved behind the first paint. A change that needs more raises the
ceiling in the same commit, with the reason in the commit message.

It reads the graph from Vite's manifest, which `vite.config.ts` moves out of the shipped client
folder to `dist/renderer-manifest.json`. The startup set is the static closure of the entry chunk,
plus the modules in the script's `STARTUP_IMPORTS` list, plus every script and stylesheet `index.html`
names, including the startup guard. `STARTUP_IMPORTS` holds modules the page imports dynamically but
always loads before it draws, and names only the entry itself. Every other dynamic import is lazy and
isn't counted.

The count has a floor. Under 100,000 B of scripts, the check is reading the wrong graph, and it fails.
The script also prints `hops`, the fetches that run one after another before the app starts, and how
much more one dynamic import away would fetch. Neither is counted.

### The terminal client

`apps/tui/scripts/check-startup-graph.mjs` runs from `@acorn/tui`'s `build`. `apps/tui/startupGraph.ts`
writes `dist/startup-graph.json` from the bundler's module graph. It includes `main.js`, every
top-level dynamic import in that entry, and their full static dependencies. Imports inside functions,
including the roster loaded after the first frame, are outside the set. A dependency reached both
statically and dynamically still counts.

The ceiling is 720,000 B, about 4% above the production measurement of 692,052 B across 158 chunks on
October 2, 2026. Production output is minified with Oxc. Zod is bundled and tree-shaken, and
validation still runs before untrusted content is drawn. Other external imports are listed
separately, and their package bytes aren't in the budget. The client imports narrow supported
entrypoints for its model and host adapters, not broad `public.ts` barrels, which would pull DOM
components and diff code into the closure.

### Unused kit components drop out

A barrel such as `kit/components/content` would pull every component it re-exports onto the startup
graph, because Solid compiles a file with a delegated event into a module-level `delegateEvents([...])`
call, and a bundler keeps a module that does work at import. The renderer's `vite.config.ts` declares
`packages/client-core/src/kit/components/**/*.tsx` side-effect-free, so an unused component is left
out. That's true only while those files do nothing at module scope, so an architecture rule in
`tools/arch/boundaries.test.ts`, "a kit component module does nothing at import", fails on any
top-level statement that isn't an import, a declaration, or a subcomponent assignment. Code that has
to run on import belongs in a `.ts` module outside `kit/components`.

### Why a name test as well as a byte total

A byte total alone lets a heavy chunk in whenever something else shrank, and a red total that drifts
slowly stops being read. So each check denies names. Both lists hold `shiki`, `wasm`, `DiffPane`,
`prModel`, `prSections`, `viewState`, and `icon-nodes`: lazy views that once leaked into the eager
graph. The renderer's list adds plugin code a registration needs only when it draws: `MemoryAddForm`,
the workflow editor's `draft-` and `draftStore`, `stepFields`, `GithubImporter`, `PreviewTaskPane`, and
`PreviewPane`. The terminal list adds `drizzle-orm`, the remote tree implementation and its kit host,
and the post-frame roster.

Both checks test names against modules as well as chunks. The renderer's `vite.config.ts` writes
`dist/renderer-modules.json` beside the manifest, listing each chunk's source modules, and the check
tests every folder on a startup module's path and its file name, written the way a chunk would be
named (`draft.ts` as `draft-`). A module that startup code imports statically merges into a chunk
named after some other module, so a chunk-name test alone never sees it. The terminal client's graph
also records source modules and external imports.

The usual cause is a string-keyed table from a name to a value instead of to a loader, which pulls
every value into whichever chunk holds the table. `kit/tokens/iconNodes.ts`
([icons](../ui-design/icons.md) § Which names are drawn without waiting), the desktop kit table
([plugins](../plugins.md) § The tree contract), the CodeMirror language map ([editor](../editor.md)),
and the GitHub plugin's PR pane contribution all load lazily for this reason.

A chunk's name is one module's name, so it can move when the graph changes. The pull request model was
`prModel` until its pane's contribution went lazy, and then the same modules landed in `prSections`.
Both stay listed. A prefix that names no chunk isn't an error, because a module can be renamed.

The renderer script also has a `KNOWN` list: denied names that are allowed on the startup list for
now, reported loudly without failing. It may only shrink. Once a chunk with that name is built and no
longer fetched at startup, the check fails until the entry is deleted. The list is empty. The terminal
check has no allowances, and fixture tests cover its byte count, merged modules, and external imports.
