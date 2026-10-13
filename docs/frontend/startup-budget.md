# Startup budget

This page covers the build checks on what the desktop renderer and the terminal client load before
they draw, and what the Node service loads before it answers. Read it before you add an import that
runs at startup, or when a build fails its budget. It's part of [frontend](../frontend.md).

## Startup budget

Both clients have a build check over what they load before they draw. Each fails the build two ways:
over a byte ceiling, or on a denied chunk or module name.

### The renderer

`apps/desktop/scripts/check-renderer-budget.mjs` runs from `@acorn/desktop`'s `build`. It sums every
script and stylesheet a cold window loads, against ceilings of 740,000 B for scripts and 200,000 B for
styles. The script ceiling is about 5% above the measurement of 703,911 B on October 9, 2026, taken
after the loaded-plugin frame, chrome, and worker hosts and the promotion modal moved behind their
first use. A change that needs more raises the ceiling in the same commit, with the reason in the
commit message.

The same check counts the compiled roster's scripts beyond startup, against a ceiling of 244,000 B,
about 5% above the 232,231 B measured the same day once the Git plugin joined the roster. The roster loads after the first frame, but the
workspace restore waits for its registration. A dynamic import that only moves startup code into the
roster saves the launch nothing, and this ceiling fails it. The roster's key, `src/client/plugins.ts`,
lives in `apps/desktop/scripts/renderer-graph.mjs`, which the size report reads too.

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

The ceiling is 700,000 B, about 3% above the production measurement of 676,436 B across 178 chunks on
October 9, 2026. Loaded-plugin frame and chrome registration load on the first distribution pass, out
of the startup graph. The Git plugin stays in the roster after the first frame. Production output is minified with Oxc. Zod is bundled and tree-shaken, and
validation still runs before untrusted content is drawn. Other external imports are listed
separately, and their package bytes aren't in the budget. The client imports narrow supported
entrypoints for its model and host adapters, not broad `public.ts` barrels, which would pull DOM
components and diff code into the closure.

### The node service

`apps/node/scripts/check-service-budget.mjs` runs from `@acorn/node`'s `build`. It counts
`service.js` and every chunk it reaches through static imports, against a ceiling of 1,785,500 B. The
ceiling is about 2 KB above the minified measurement of 1,783,583 B on October 13, 2026, on macOS arm64.
That figure includes the Git plugin's checkout admission and the security programme's MCP server
store and credential renewal, which boot or every agent session start needs. It also includes the
code that starts an installed plugin without a restart, and the browser extension's boot-time checks:
plugin handoff declarations in manifest validation and site associations in project config. It also
includes mid-turn steering in the agent session runtime, which every running turn can reach. It follows the GitHub
mirror routes, the tunnel's `ws` server, workflow file authoring, and the usage probes moving to
first use ([evidence](../testing/selective-server-loading-2026-10-09.md)). Under 1,000,000 B,
the walk has stopped following imports, and the check fails. To cut the graph, see
[load a route on first use](../plugin-authoring/the-node-half.md#load-a-route-on-first-use).

The build minifies with Oxc and keeps function and class names, so the ceiling is in minified bytes.
Earlier ceilings in the script's history were unminified. The check never reads the chunk text. The
build's `acorn:service-startup-graph` plugin writes `dist/startup-graph.json` from the bundler's records:
each chunk's static and dynamic edges, its external packages, the packages its modules load through
`createRequire`, its source modules, and its emitted size. A lazy chunk that gains a static import
joins the closure and its bytes count, however the output is formatted.

`scripts/chunkGraph.mts` writes and reads that graph, for this check, the size report, and the
standalone manifest check. The terminal client writes its graph with the same code. The reader fails
when the graph names a missing file, records a size a file no longer has, misses a script in a chunk
folder, or has an edge to a chunk it doesn't describe. The check prints the external packages the
closure loads at startup, on first use, and through `createRequire`.

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
`PreviewPane`. It also names the loaded-plugin host and the promotion modal: `workerHost`,
`chromeRegister`, `chromeData`, which frame registration imports, and `PromoteToTaskModal`. The
renderer tests its whole list against the roster as well as startup. The terminal list adds
`drizzle-orm`, the remote tree implementation and its kit host, `chromeRegister`, and the post-frame
roster. The terminal client draws loaded rail rows at startup, so `chromeData` stays on its graph.

Both checks test names against modules as well as chunks. The renderer's `vite.config.ts` writes
`dist/renderer-modules.json` beside the manifest, listing each chunk's source modules, and the check
tests every folder on a startup module's path and its file name, written the way a chunk would be
named (`draft.ts` as `draft-`). A module that startup code imports statically merges into a chunk
named after some other module, so a chunk-name test alone never sees it. The terminal client's graph
also records source modules and external imports.

A registration module that imports one name from a barrel loads the whole barrel, because client-core
modules create stores at import and the bundler keeps them. The compiled host barrel,
`@acorn/plugin-api/ui/host`, put the frame host, worker host, and promotion modal into the roster
through one keybinding import. Registration code imports `@acorn/plugin-api/client` and narrow
entrypoints instead ([plugin API](../plugins/plugin-api.md)).

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
