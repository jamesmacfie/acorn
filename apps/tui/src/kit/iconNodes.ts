// lucide's icon geometry, as this host's answer: nothing.
//
// The fifth alias in the host switch (../vite.config.ts), and the second that removes a package rather
// than swapping a component for one. `lucide-static/icon-nodes.json` is 706 KB of SVG path data, and
// there is no SVG in a terminal: `Icon` here is a lookup from a Lucide name to one character
// (./glyphs.ts), and the DOM component that reads this table cannot draw on a cell host at all. It is
// in the graph because client-core's components have to resolve, not because any of them run.
//
// Without the alias the terminal crashed, and it took until someone opened Linear to find out. The
// bundle externalises every bare import of a package outside the workspace, so this one was left for
// Node's own loader — which refuses a JSON module with no `with { type: 'json' }` on it and throws
// ERR_IMPORT_ATTRIBUTE_MISSING from inside a lazily loaded chunk. Writing the attribute does not help:
// the TypeScript transform drops it before the bundler sees it. Inlining the file instead would put
// 706 KB of paths nobody can draw into six chunks.
//
// An empty table is the honest answer and a safe one: a DOM `Icon` handed a name it has no nodes for
// draws nothing, which is what this host's `Icon` does with an unknown name anyway.
export default {} as Record<string, [string, Record<string, string>][]>
