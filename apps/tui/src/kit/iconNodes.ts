// lucide's icon geometry, as this host's answer: nothing. Both halves of it — the census's eager map
// and the full set behind the dynamic import — resolve here through the host switch's aliases in
// `apps/tui/vite.config.ts`.
//
// lucide-static's `icon-nodes.json` is hundreds of KB of SVG path data, and there is no SVG in a
// terminal: `Icon` here draws nothing, and the DOM component that reads this table cannot draw on a
// cell host at all. It is in the graph because client-core's components have to resolve, not because
// any of them run.
//
// Without the alias the terminal crashes the first time a lazily loaded chunk reaches the table. The
// bundle externalises every bare import of a package outside the workspace, so this one would be left
// for Node's own loader — which refuses a JSON module with no `with { type: 'json' }` on it and throws
// ERR_IMPORT_ATTRIBUTE_MISSING. Writing the attribute does not help: the TypeScript transform drops it
// before the bundler sees it. Inlining the file instead would put paths nobody can draw into several
// chunks.
//
// An empty table is the honest answer and a safe one: a DOM `Icon` handed a name it has no nodes for
// draws nothing, which is what this host's `Icon` does.
export default {} as Record<string, [string, Record<string, string>][]>
