# Patches

pnpm applies each file here to the package named in `pnpm-workspace.yaml` under `patchedDependencies`.
A version bump of that package drops the patch and pnpm says so at install; re-apply it with
`pnpm patch <name>@<version>`, make the same change, then `pnpm patch-commit`.

## solid-js: `<Show>` holds its last value

Solid's `<Show>` hands a child function an accessor for the narrowed `when` value. Upstream, that
accessor throws `Stale read from <Show>` if it is read in the same tick `when` becomes falsy. Any
memo under the Show that reads the accessor can be forced to run before the Show disposes it, so a
pane that clears its selected session threw in the terminal client's main pane
(apps/tui/src/panel.tsx catches it and draws the message). The patch returns the last truthy value
instead; the Show disposes the child a moment later. plugins/agents/src/client/showHolds.test.tsx
checks the installed copy carries it.

## solid-js: a boundary that has drawn never un-draws

`Suspense` is only ever around a `lazy()` in this repo. Nothing loads data through it: every surface
holds its own empty and busy states, and `packages/client-core/src/host/registries/panes/panes.ts`
puts a boundary around each pane region for one reason, which is that a pending `lazy()` renders as an
empty string and the cell host refuses that.

`@tanstack/solid-query` still suspends whatever boundary is above it. Reading `.data` on a query whose
cache is empty reads its resource, and a resource read under a boundary registers with it, so a query
that starts *after* the region has drawn takes the whole region back out of the document until the
fetch lands. Upstream `Suspense` records `store.resolved` when it first shows its content and then
never looks at it; the patch reads it, in the two places that ask whether the boundary is in fallback.
So the first paint is unchanged, and every suspension after it leaves the content and its effects
where they are.

What this costs: a boundary that has drawn and is then handed a **different** `lazy()` child draws
that child's empty string rather than the fallback, for as long as the second module takes. Three
boundaries have children that change — the terminal client's `PanelBody` (`apps/tui/src/panel.tsx`),
around the main panel and the browse panel for the life of the shell, and each plugin tree root in
`host/tree/TreeHost.tsx`. Two of those three already fall back to `null`, so nothing changes; the main
panel draws a blank line where it drew `Loading…`. An empty string is a legal `#text` on both hosts —
the cell host's orphan-text rule went with the terminal rewrite (`apps/tui/src/tree/renderer.ts`) —
so this is a frame of nothing, not a refused mount.
`packages/client-core/src/host/registries/panes/panes.test.tsx` checks the installed copy carries it.
