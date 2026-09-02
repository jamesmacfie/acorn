# Phase 1: registries hold loaders

Status: not started. Waits on phase 0 for the denylist that turns green here.

## Goal

No string-keyed table from a name to code holds the code. The kit component tables on both hosts,
the iframe path's copy, and the CodeMirror language table map a name to a loader, and the heavy
entries load on first use. The desktop startup list loses `shiki`, `DiffPane`, and `prModel`; the
terminal client's eager graph loses CodeMirror, its 19 grammars, and the pull-request model; opening
a file in the editor fetches one grammar. This is [decisions.md](./decisions.md) decision 3.

## Why this phase, and why now

The first read measured 190 KB of syntax highlighter and 75 KB of diff viewer in the desktop's
startup list and said the eager import that pulled them in was "the actual bug" without tracing it.
The second read traced it. `packages/client-core/src/host/tree/components.ts` is an eager record from
kit node name to component, built so a loaded plugin's tree can name `DiffPane` and have the host
draw it. It imports `packages/client-core/src/features/diff/DiffPane.tsx`, which imports
`packages/client-core/src/infra/highlight/worker.ts`, which imports the highlighter. The table lands
in the `RemoteTree` chunk, and that chunk is in the modulepreload list whether or not any loaded
plugin is installed, because `RemoteTree` is the fallback branch of `packages/client-core/src/host/tree/Slot.tsx`.
`packages/client-core/src/host/frames/remoteSolid.ts` holds a second copy of the table for the
iframe path.

The terminal client has the same table in `apps/tui/src/kit/components.tsx`, and one more import of
the same kind: `apps/tui/vite.config.ts` aliases `@acorn/plugin-api/ui` and `ui/host` to the TUI's
kit but not `ui/editor`, so `plugins/editor/src/client/EditorPane.tsx` pulls
`packages/client-core/src/features/editor/language.ts` and its 19 static `@codemirror/lang-*` imports
into a process that never draws CodeMirror. `apps/tui/src/harness.tsx` says what that costs:
"seconds". On the desktop the same file is why the editor's lazy chunk is 954,915 bytes: a `.ts`
file downloads every grammar.

These are four instances of one mistake, and the icon set in phase 0 is a fifth. A table that maps a
name to a value pulls every value into the chunk that holds the table. The fix is the same each time,
and the rule is worth a test because the two builds measured two days apart show the tree drifts
toward eagerness on its own.

## Scope

In:

- `KIT_COMPONENTS` in `host/tree/components.ts` and its twin in `frames/remoteSolid.ts` become one
  table, and the heavy names in it become loaders: `DiffPane`, `DiffLine`, `Markdown` (whose
  highlighter path is the shiki edge), `Timeline`, and the editor surfaces. Cheap primitives stay
  eager; a `Button` behind a dynamic import would cost a frame for nothing.
- One `Suspense` boundary per tree root in `packages/client-core/src/host/tree/TreeHost.tsx` and
  `apps/tui/src/plugins/TreeHost.tsx`. Today both render `<Dynamic component={KIT_COMPONENTS[type]}>`
  with no boundary, and a lazy component under `Dynamic` suspends the nearest ancestor, which would
  be the whole tree.
- `apps/tui/src/kit/components.tsx`: the same split.
- An alias for `@acorn/plugin-api/ui/editor` in `apps/tui/vite.config.ts` and the package's
  `tsconfig.json` paths, pointing at a stub that exports `languageForPath` returning `null`, the
  theme accessors returning the terminal palette, and no-op view-state helpers. The `editor`
  rectangle in `apps/tui/src/kit/rectangle.tsx` already draws the file read-only with the `$EDITOR`
  handoff, so nothing on this host loses a feature.
- `packages/client-core/src/features/editor/language.ts`: the language table maps id to
  `() => import('@codemirror/lang-x')`. `languageForPath` returns a promise or a resolved extension,
  and `plugins/editor/src/client/EditorPane.tsx` awaits it inside the `stateFor(path)` step that
  already awaits the file read, so no new async boundary appears in the pane.
- The rule as a test. Simplest: the phase 0 denylist already refuses `shiki`, `DiffPane`, and
  `prModel` in the startup list on both hosts, and that is the enforcement. A stricter arch rule in
  `tools/arch/boundaries.test.ts`, "a module exporting a `Record<string, Component>` may not
  statically import from `features/`", is written down here as the fallback if the denylist proves
  too coarse.

Out: the icon split (phase 0). Lazy loading of pane contributions, which already are
(`plugins/editor/src/client/paneContribution.ts` and its siblings). Any change to the tree protocol.

## Design

**One table, two hosts, one shape.** The desktop's two copies merge into `host/tree/components.ts`,
which `remoteSolid.ts` imports. Each entry is either a component or a loader:

```ts
type KitEntry = Component<any> | { load: () => Promise<{ default: Component<any> }> }
```

`TreeHost` resolves an entry through one helper that returns the component directly or wraps the
loader in `lazy()` once and caches the result by name, so a tree with fifty `DiffLine`s creates one
lazy component, not fifty. The terminal client's table takes the same type from client-core and
supplies its own components.

**Suspense per tree root, fallback null.** A loaded plugin's tree is one slot; the slot shows nothing
for the frame the first heavy component takes to arrive, which is the behaviour the pane registry
already chose for regions (`packages/client-core/src/host/registries/panes/panes.ts` wraps each region
in `Suspense fallback={null}`). The OpenTUI destroy race under `Suspense` is fixed in
`apps/tui/src/kit/reconciler.ts`, so this host can take the boundary too.

**The language table returns a loader.** `languageForPath(path)` becomes `async` and returns the
extension or `null`. The pane's `stateFor(path)` already awaits `api.read`; it awaits both in a
`Promise.all` and builds the `EditorState` once. The four legacy stream modes come along in the same
shape. Nothing else imports `language.ts` directly; the facade `packages/plugin-api/src/ui/editor.ts`
re-exports it and picks up the new signature.

**The TUI stub is a real module, not an alias to nothing.** It lives at `apps/tui/src/kit/editor.ts` (new)
and exports the same names with the same types as the facade, so `EditorPane` compiles
unchanged. `languageForPath` returns `null` because cells have no grammar to load.

## Code touched

- `packages/client-core/src/host/tree/components.ts`, `packages/client-core/src/host/frames/remoteSolid.ts`,
  `packages/client-core/src/host/tree/TreeHost.tsx`.
- `apps/tui/src/kit/components.tsx`, `apps/tui/src/plugins/TreeHost.tsx`, `apps/tui/src/kit/editor.ts` (new),
  `apps/tui/vite.config.ts`, `apps/tui/tsconfig.json`.
- `packages/client-core/src/features/editor/language.ts`, `packages/plugin-api/src/ui/editor.ts`,
  `plugins/editor/src/client/EditorPane.tsx`, and `packages/client-core/src/features/editor/DocumentSurface.tsx`
  if it resolves a language itself.
- `packages/plugin-api/src/surface.snapshot.txt` if `languageForPath`'s signature is on the surface.

## Tests

- `components.test.ts` (new, beside the table): every `KitNodeName` in
  `packages/client-core/src/kit/tokens/support.ts` has an entry, and every entry whose name is on the
  heavy list is a loader, not a component. The heavy list is the test's, so adding a heavy component
  eagerly fails here before it fails the build.
- `TreeHost` in the jsdom `hosts` project: a batch inserting a `DiffPane` renders the fallback for
  one tick, then the pane; a second `DiffPane` in the same tree reuses the lazy component.
- The TUI `tools/arch/kitTable.test.ts` still holds both hosts' tables to the same names.
- `language.test.ts`: `languageForPath('a.ts')` resolves the JavaScript extension and loads no
  other grammar module (assert through a module-level counter in a test double, or through Vite's
  manifest in an integration check).
- Both startup checks from phase 0 pass with the denylisted names absent.

## Docs owed

`docs/plugins.md` § The tree contract: the host's component table maps a name to a component or a
loader, and a heavy node may take a frame to arrive. `docs/editor.md`: `languageForPath` is async and
loads one grammar. `docs/tui.md` § The host switch: a seventh alias, `ui/editor`, and why.
`docs/architecture-overview.md` § Package boundaries, if the arch rule ships.

## Done when

- The desktop startup list contains no chunk named `shiki`, `wasm`, `DiffPane`, or `prModel`, and
  the budget script says so.
- The TUI's eager closure is under 550 KB, half the 1.06 MB measured on 2026-09-02, and
  `check-startup-graph.mjs` holds that ceiling.
- Opening a `.ts` file in the editor pane fetches one `lang-javascript` chunk and no other grammar.
- A loaded plugin's tree that draws a `DiffPane` still draws it, after one empty frame.

## Verify before building

- Confirm `host/tree/components.ts` still imports `DiffPane` statically and `remoteSolid.ts` still
  holds its own table. Read at `17a9acdf`.
- Confirm both `TreeHost.tsx` files still render `Dynamic` with no `Suspense` above it.
- Confirm `apps/tui/vite.config.ts` aliases exactly `ui` and `ui/host`, and that `EditorPane.tsx`
  imports from `@acorn/plugin-api/ui/editor`.
- Confirm `language.ts` still imports the grammars statically. Count them; the number here is 19.
- The `Suspense` destroy race fix in `reconciler.ts` is what makes the TUI boundary safe. Read its
  comment before relying on it.
