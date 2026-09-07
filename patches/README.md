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
