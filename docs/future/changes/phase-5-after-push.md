# Phase 5: after the push

Status: not started. Waits on phase 3. Optional; the panel is complete without it.

## Goal

A remote extension point, `changes:push-actions`, drawn as a `Slot` under the remote bar, where
another plugin may put one action that makes sense once a branch is on its remote. The GitHub plugin
fills it with **Open pull request** for a task with a published branch and no pull request, which
opens its create form with the head branch filled in.

## Why this phase, and why now

Commit, push, open a PR is the whole loop for most tasks, and the third step today is a rail
navigation away. The changes plugin cannot import the GitHub plugin, and should not know what a pull
request is, so this is a point the owner declares and the GitHub plugin fills, on the pattern the
changes plugin already uses for its tool card in `agents:tool-card`.

## Scope

In:

- `PUSH_ACTIONS_POINT = 'changes:push-actions'` in `plugins/changes/src/client/extensionPoints.ts`,
  registered as `kind: 'remote'`, `mode: 'stack'`, `max: 2`, with props
  `{ taskId, projectId, branch, upstream, ahead }`.
- A `Slot` for it at the bottom of the bar's footer row, with no fallback children, so an unfilled
  point draws nothing and takes no space.
- In the GitHub plugin: `ctx.extensions.register({ point: 'changes:push-actions', component })`
  where the component renders a `Button` reading **Open pull request** when `upstream` is set and
  the task has no `pullNumber`, and navigates to the plugin's create route with `head` set, which
  the form already reads from the URL (`plugins/github/src/client/createPull/model.ts`).

Out: creating the PR from the panel, a PR status in the bar, anything for Linear or Rollbar. Once a
PR exists the PR pane appears and owns everything about it.

## Design detail

**A remote point, not a rows point.** Rows carry display strings and one verb declared in the
manifest; the verb here is "go to a route of mine with a parameter from the props", which is code,
and the cheapest code that can run in another plugin's surface is a kit tree. `remote` is the kind
for that (`docs/plugins.md` § Cooperative extension points).

**Props are facts, never markup.** The props are the five scalars the bar already has. The GitHub
plugin reads `pullNumber` from its own task query, not from the props, because the changes plugin
does not know the word.

**Max two.** A second filler is plausible (a deploy plugin's "Open preview" after a push). A third
is a toolbar, and a toolbar in another plugin's footer is a design nobody has asked for.

## Code touched

- `plugins/changes/src/client/extensionPoints.ts`: the point and its props type.
- `plugins/changes/src/client/index.ts`: the registration.
- `plugins/changes/src/client/RemoteBar.tsx` (new in phase 3): the `Slot`.
- `plugins/github/src/client/pushActions.tsx` (new): the component.
- `plugins/github/src/client/index.ts`: the extension registration.

## Tests

- `RemoteBar.test.tsx`: an unfilled slot renders nothing; a filler receives the five props.
- `pushActions.test.tsx` (new, jsdom in the GitHub plugin): hidden with a `pullNumber`; hidden with
  no upstream; otherwise a button whose activation navigates to the create route with `head`.
- The unmatched-extensions diagnostic (`unmatchedExtensions()` in
  `packages/client-core/src/host/registries/extensionPoints/extensionPoints.ts`) stays empty in the roster test.

## Docs owed

Per [docs-migration.md](./docs-migration.md), phase 5 rows: `docs/plugins.md` § Cooperative
extension points.

## Doors left open

- A loaded plugin fills the same point through its manifest with a `remote` entry; nothing here
  needs to change for that.

## Done when

- After **Publish** on a task with no PR, **Open pull request** appears under the bar and opens the
  form with the branch selected. After the PR exists, it is gone.
- With the GitHub plugin disabled, the footer is the same height as before this phase.
- `pnpm lint`, both plugins' tests, and the arch suite are green.

## Verify before building

- Phase 3 has shipped: `RemoteBar.tsx` exists.
- `plugins/changes/src/client/index.ts` still registers a compiled extension with a `component` into
  `AGENT_TOOL_CARD_POINT`, which is the shape the GitHub plugin copies.
- `packages/client-core/src/host/tree/Slot.tsx` still takes `point`, `props`, and `taskId`.
- `plugins/github/src/client/clientRoutes.ts` still has `github.create` at `/p/:projectId/pulls/new` and
  the form still reads `head` from the query string.
