# Phase 3: the remote bar

Status: not started. Waits on phase 0.

## Goal

A bar between the list and the commit editor names the project and branch, shows `↓behind ↑ahead`
against the upstream, and offers one primary button whose label is the next thing to do: **Publish**
with no upstream, **Pull** when behind, **Push** when ahead, **Fetch** when in sync. A menu beside it
holds Fetch, Pull, Pull with rebase, Push, and Force push. While a merge or rebase is mid-flight a
banner above the bar says so and offers **Abort**.

## Why this phase, and why now

It is the phase people will notice first. "Did I push that" and "am I behind main" are the two
questions the pane cannot answer today, and both come from a status call phase 0 already makes.
Pull is the operation most likely to leave a worktree in a state the pane cannot describe, which is
why the banner and abort land in the same phase as pull and not later.

## Scope

In:

- The bar: `Toolbar size="sm"` with a `git-branch` `Icon`, the project name and branch as muted
  text, the project path's `CopyButton` moved here from the header, a `Toolbar.Spacer`, the counts,
  the primary `Button`, and a `Button iconOnly opens="menu"` for the verbs.
- `primaryRemote()` in `plugins/changes/src/client/model.ts`: `publish` when `upstream` is null,
  `pull` when `behind > 0`, `push` when `ahead > 0`, else `fetch`. Behind wins over ahead because
  a push from behind fails and a pull from ahead does not.
- The node: `fetch`, `pull({ rebase })`, `push({ force })`, `abort`, per
  [03-anatomy.md](./03-anatomy.md) § The node calls, all with a 120 second timeout. `before-push`
  payload gains `force`.
- `remoteBusy` on the model replaces `pushing`; the primary button shows `busy` and the menu is
  disabled while any remote verb runs.
- Force push in the menu is a `ConfirmButton variant="bare"`: first press arms it and the item reads
  **Force push?**, second press runs `push --force-with-lease`.
- The banner: an `Alert` reading "Rebase in progress" or "Merge in progress" with an armed
  **Abort**. Drawn from `status().operation`, so a rebase started in the terminal shows it too.
- Palette rows `changes.fetch`, `changes.pull`, `changes.push`, `when: 'pane'`.
- `head:changed` subscription on the model, so a commit from the terminal moves the ahead count
  within a poll.
- Results: a successful verb refetches and clears the alert; a refusal puts git's reason in the
  `Alert`, trimmed to its first 400 characters as today.

Out: other remotes, a branch picker, resolving conflicts in the pane, chords on the verbs. See
[refused.md](./refused.md).

## Design detail

**Pull is fast-forward only, and says why when it cannot.** `git pull --ff-only` refuses a diverged
branch with "Not possible to fast-forward", and the alert appends "Use Pull with rebase from the
menu." That makes the default pull safe to press without reading, and the rebase a deliberate second
press.

**A pull that conflicts leaves the tree in an operation.** The next status read sets `operation`,
the banner appears, Conflicts becomes the first group with the conflicted files, and the primary
button is disabled while the banner shows. Resolving is the editor's or the terminal's job; **Abort**
is the panel's, because the panel started it. `git rebase --continue` is a door, not a button: it
needs the conflicts resolved and staged first, and a button that fails until then is a button that
lies.

**Publish is push with an upstream.** `git push --set-upstream origin HEAD` is what the bridge runs
today, so publish and push are the same call and the label is the only difference. Keeping the
`--set-upstream` on every push is harmless and means a branch whose upstream was deleted republishes
without a second verb.

**Force push refuses to overwrite what the node has not seen.** `--force-with-lease` with no
argument compares the remote ref against the local remote-tracking ref, so a fetch that showed
someone else's commit makes the push fail with a reason instead of dropping their work. Combined with
the arm and the hook's `force: true`, three things have to agree before a remote commit is replaced.

**Counts are facts, not buttons.** `↓2 ↑144` is text. Zed makes it part of the button; here it sits
beside it so the button's label is only the verb, which is what the terminal projection needs when
the row is 40 cells wide.

## Code touched

- `plugins/changes/src/server/localDiff.ts`: `fetch`, `pull`, `pushBranch` takes `{ force }`,
  `abortOperation`. All through `git()` with `timeoutMs: 120_000`.
- `plugins/changes/src/server/localGit.ts`: the four bridge members; `force` in the `before-push`
  declaration and call.
- `plugins/changes/src/server/routes/localGit.ts`: the routes and their bodies.
- `plugins/changes/src/shared/api.ts`: the builders; the `push` action route gains a body.
- `plugins/changes/src/client/changesClient.ts`, `changesModel.tsx`, `model.ts`.
- `plugins/changes/src/client/RemoteBar.tsx` (new): the bar and the banner, mounted at the top of
  the footer.
- `plugins/changes/src/client/commands.ts` (new in phase 2): the three palette rows.
- `plugins/changes/src/client/ChangesPane.tsx`: the header loses the project path.

## Tests

- `model.test.ts`: `primaryRemote` over the fixtures: no upstream, behind only, ahead only, both,
  neither.
- `localDiff.test.ts`: `pull({ rebase: true })` builds `pull --rebase`; `pushBranch({ force: true })`
  builds `push --force-with-lease --set-upstream origin HEAD`; `abortOperation('rebase')` builds
  `rebase --abort`.
- `localGit.test.ts` (bridge): a `before-push` handler sees `force: true` on a force push and its
  veto reaches the caller with the plugin's name.
- `localGit.test.ts` (routes): `{ force: 'yes' }` is 400; `{ rebase: true }` reaches the bridge.
- `RemoteBar.test.tsx` (new, jsdom): the label follows `primaryRemote`; the menu is disabled while
  busy; force push needs two presses; the banner shows with `operation: 'rebase'` and hides the
  primary button.

## Docs owed

Per [docs-migration.md](./docs-migration.md), phase 3 rows: `docs/plugins.md` § Hooks,
`docs/security.md` § Process, path, and configuration controls, `docs/testing.md` smoke checklist.

## Doors left open

- A `changes:push-actions` slot under the bar is phase 5. The bar leaves the vertical space.
- **Continue** during a rebase, once the panel can tell every conflict is staged. `LocalStatus`
  already carries what that needs.
- An ahead marker on the rail, through `registries/railMarkers.ts`. Not this programme.

## Done when

- A branch with no upstream reads **Publish**; after pressing it, **Fetch**; after a commit,
  **Push ↑1**; after someone else pushes and a fetch, **Pull ↓1**.
- Pull on a diverged branch is refused with the rebase hint; Pull with rebase into a conflict shows
  the banner and the Conflicts group; **Abort** returns the tree to where it was.
- A force push arms first, runs with a lease, and a `before-push` veto stops it with the plugin's
  name in the reason.
- `pnpm lint`, the changes plugin's tests, and the arch suite are green.

## Verify before building

- Phase 0 has shipped: `LocalStatus` carries `upstream`, `ahead`, `behind`, and `operation`.
- `packages/node-core/src/server/core/git.ts` still passes `SSH_AUTH_SOCK` and sets
  `GIT_TERMINAL_PROMPT=0`, so a fetch with expired credentials fails fast rather than hanging to the
  timeout.
- `packages/client-core/src/infra/node/watchNodeEvents.ts` still re-emits `head:changed` on `clientEvents`.
- `plugins/changes/src/server/localGit.ts` `CHANGES_HOOKS` still declares `before-push` with
  `allows: ['observe', 'veto']`.
- `packages/client-core/src/kit/components/primitives.tsx` still exports `ConfirmButton` with `variant`.
