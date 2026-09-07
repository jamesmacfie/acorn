# Phase 2: the commit editor

Status: not started. Waits on phase 0.

## Goal

The footer's commit field is a `Textarea` that grows, holds a device-local draft that survives a
relaunch and a trip to the diff column, and expands into a `Modal` for a long message. The button
beside it reads **Commit** when something is staged, **Commit tracked** when nothing is staged but
tracked changes exist, and **Amend** when amend is on. A menu beside it holds Amend, Sign-off, and
Skip git hooks. `meta+enter` commits, `meta+shift+enter` amends.

## Why this phase, and why now

This is the control people use most. The one-line field that appears only when something is staged is
the single most visible gap between the pane and the screenshots, and it needs nothing from the
remote bar to land.

## Scope

In:

- `draft` on the model: read on build from `changes:commit-draft:<taskId>` in `localStorage`
  through the draft helper the diff rows already use (`packages/client-core/src/kit/lib/draftState.ts`),
  written on every input, cleared on a successful commit.
- The editor: `Textarea grow rows={3} mono` with the placeholder "Commit message", always visible
  when the tree is a git tree. An icon button in the footer's toolbar opens the expanded `Modal`,
  whose `Textarea` binds to the same `draft`, with **Commit** in `ModalActions`.
- `commitMode()` in `plugins/changes/src/client/model.ts`: `staged` when the staged group is
  non-empty, `tracked` when it is empty and the tracked group is not, `none` otherwise. The button
  is disabled in `none` and when the draft is blank.
- Commit options as session signals: `amend`, `signoff`, `noVerify`. The menu draws them as checked
  items. Turning amend on with an empty draft fills it from `headCommit`; turning it off leaves the
  text.
- The node: `headCommit` and the extended `commit` body from [03-anatomy.md](./03-anatomy.md) § The
  node calls. `before-commit` payload gains `amend`.
- Commands `changes.commit` and `changes.amend` with their chords, `when: 'pane'`, pane `changes`,
  active while the editor has focus.
- On success: draft cleared, amend turned off, status refetched. On refusal: the reason in the
  `Alert` above the editor, draft kept.

Out: the wand (phase 4), the bar (phase 3), a message template or a subject-length rule. A
commit-lint plugin transforms or vetoes through `before-commit`, which is what the hook is for.

## Design detail

**Commit tracked is `git commit -a`.** It stages every tracked modification and deletion and commits
them; untracked files are untouched, which is the same rule Zed follows and the same thing the label
says. The client sends `all: true` when `commitMode()` is `tracked`; the node does not guess.

**Amend is a mode, not a verb.** Zed's chord commits as an amend in one stroke, and the menu item
toggles a mode whose button then reads **Amend**. Both are offered. The prefill from `headCommit`
happens only into an empty draft, so a person who wrote a new message and then decided to amend
keeps what they wrote. After an amend the branch is ahead of an upstream that has the old commit,
and phase 3's bar will read **Push** with a lease failure waiting; the failure's reason says to use
Force push. Phase 3 makes that explicit.

**Skip git hooks skips git's hooks.** The menu item's hint reads "git's pre-commit and commit-msg
hooks; acorn's before-commit chain still runs". The two things have the same name and are not the
same thing, and the one place a person can learn that is the menu.

**The draft is device state by the recorded decision.** `docs/state-ownership.md` § Scope rules says drafts are
losable and device-local. The key includes the task id and the node is not in it, because a draft
follows the worktree the person is looking at, and the same task on another node is another task.

**Two chords, one intent.** `meta+enter` is the `commit` intent in the closed set
(`docs/command-palette-and-shortcuts.md` § Focus and typing), so the binding is typing-exempt inside
the `Textarea` by construction. `meta+shift+enter` is registered beside it. Neither is handled in the
pane; both are commands.

## Code touched

- `plugins/changes/src/server/localDiff.ts`: `headCommit`, `commitStaged` takes options.
- `plugins/changes/src/server/localGit.ts`: `headCommit` on the bridge; `commit(taskId, message,
  options)`; the `amend` boolean in the `before-commit` payload declaration and call.
- `plugins/changes/src/server/routes/localGit.ts`: `commitBody` grows; `GET /:id/local/head-commit`.
- `plugins/changes/src/shared/api.ts`: the route builders.
- `plugins/changes/src/client/changesClient.ts`, `changesModel.tsx`, `model.ts`.
- `plugins/changes/src/client/ChangesPane.tsx`: the footer's editor, button, and menu.
- `plugins/changes/src/client/CommitModal.tsx` (new): the expanded editor.
- `plugins/changes/src/client/commands.ts` (new): the two commands and bindings, registered from
  `index.ts` and disposed together, on the pattern in `plugins/github/src/client/Shortcuts.tsx`.

## Tests

- `model.test.ts`: `commitMode` over the three fixtures; a conflicted-only tree is `none`.
- `localDiff.test.ts`: `commitStaged` with `{ all, amend, signoff, noVerify }` builds the expected
  argv in that order; an empty message is refused before git runs.
- `localGit.test.ts` (bridge): a `before-commit` handler sees `amend: true` on an amend and a
  transform's message is what git receives.
- `localGit.test.ts` (routes): `{ message: 'x', amend: 'yes' }` is 400.
- `ChangesPane.test.tsx`: the button label follows `commitMode`; toggling amend with an empty draft
  fills it from `headCommit`; a successful commit clears the draft and the amend flag; the draft is
  re-read from `localStorage` on a fresh model.
- `commands.test.ts`: the binding ids equal the command ids and both are active only on the changes
  pane.

## Docs owed

Per [docs-migration.md](./docs-migration.md), phase 2 rows: `docs/panes.md` § Layout model,
`docs/plugins.md` § Hooks, `docs/state-ownership.md` § Scope rules,
`docs/command-palette-and-shortcuts.md` § Plugin shortcuts, `docs/testing.md` smoke checklist.

## Doors left open

- A subject and body split with a 72-column guide is a `Textarea` prop the kit does not have and a
  commit-lint plugin already covers the rule. Not built.
- The wand's button position in the toolbar is reserved: phase 4 puts it at the left, where Zed
  does.

## Done when

- A draft typed, followed by a switch to the diff column below 80 columns and back, is still there.
  So is one typed before a relaunch.
- With nothing staged and two edited files, **Commit tracked** commits both and leaves an untracked
  file alone.
- Amend with an empty editor shows HEAD's message; `meta+shift+enter` from the editor amends.
- A `before-commit` veto shows its reason and keeps the draft.
- `pnpm lint`, the changes plugin's tests, and the arch suite are green.

## Verify before building

- Phase 0 has shipped: the model has `groups()` with a `tracked` group.
- `packages/client-core/src/kit/components/primitives.tsx` still exports `Textarea` with `grow`, `rows`, and
  `mono`, and `Modal`, `ModalBody`, `ModalActions` are still on `@acorn/plugin-api/ui`.
- `packages/client-core/src/kit/lib/draftState.ts` still reads and writes one `localStorage` key.
- `docs/command-palette-and-shortcuts.md` § Focus and typing still lists `commit` as an intent on
  `meta+enter`.
- `plugins/changes/src/server/localGit.ts` `CHANGES_HOOKS` still declares `before-commit` with
  `payload: { taskId, branch, message }`.
