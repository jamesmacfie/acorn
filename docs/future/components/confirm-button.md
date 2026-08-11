# ConfirmButton

A destructive action that arms on first click and commits on second, with a timeout that disarms
it. Neither shadcn nor Bootstrap has this (they route everything through a confirm dialog), but
acorn has *organically* converged on arm-to-confirm in five places — it suits a dense
keyboard-driven UI where a modal for "remove one header row" is ceremony — and then implemented it
five different ways, while other plugins do destructive things with **no confirmation at all**.

## Today

Five hand-rolled implementations:

- `plugins/http/src/frame/confirmDelete.ts:20-34` — `createArmedDelete`, the best one: two-click
  arm-then-commit, button flips to "Delete?" with `tone='danger'`. Written because a sandboxed
  frame has no `window.confirm`. Used in `HttpPanel.tsx:66,335-345`, `HttpVariables.tsx:49,125-135`.
- `plugins/changes/src/client/ChangesPane.tsx:115-136` — `discardArmed` signal; the prompt is
  smuggled through the *error* channel ("Click discard again…").
- `plugins/docker/src/client/DockerBrowse.tsx:90-99` — `confirmedOnce(key)` with a 3s auto-reset
  *and* a pref gate (`dockerPrefs().confirmDestructive`); nine call sites render `'?'`/`'Sure?'`
  labels. `ContainerDetail.tsx:142-147` then re-implements it locally.
- `plugins/database/src/frame/DatabasePanel.tsx:346-353` — `deleteArmed`, prompt again phrased
  through `setError`.
- `plugins/notes/src/client/NotesPane.tsx:215-233` — `deleteArmed` writing "Click delete again to
  remove…" into the error banner.

And the inconsistencies this exists to fix:

- `plugins/agents/src/client/AgentPane.tsx:148,157` uses native `window.prompt`/`window.confirm` —
  unstyled in Electron, which `TabRail.tsx:225-227` documents as the reason core avoids it; core
  still slips once (`WorkspaceProjectAssignments.tsx:131`).
- github fires destructive actions with no confirmation at all (remove label
  `PullDetail.tsx:304`, remove reviewer `:433`, close PR `PullSummary.tsx:78`).

## Proposed API

```tsx
export function ConfirmButton(props: ButtonProps & {
  confirmLabel?: string          // default "Sure?"; http uses "Delete?"
  timeoutMs?: number             // default 3000; disarm on blur too
  onConfirm: () => void          // fires on the second click only
})
```

Wraps the existing `Button`. While armed: swap children for `confirmLabel`, force
`tone="danger"`, set `aria-live="polite"` on the label so the state change is announced. Escape or
blur disarms. A `skipConfirm` boolean prop lets docker keep its pref gate.

Also export the behaviour as a hook — `createArmedConfirm()` — for sites where the armed state
must live outside one button (docker's group headers arm per-row keys). This follows the house
idiom: behaviour as a hook, markup at the call site (`ui/dismissable.ts:13`).

## How to build it

- `packages/client-core/src/ui/primitives.tsx` (or a sibling `confirm.ts` for the hook +
  `primitives.tsx` for the component). No new CSS beyond what `Button`'s danger tone already has;
  maybe a `.ui-btn[data-armed]` pulse.
- Frame-safe by construction (no window.confirm, no shell state) — export from
  `@acorn/plugin-api/ui`. This is exactly what the http plugin needed and had to build itself.
- Lift the semantics from `plugins/http/src/frame/confirmDelete.ts`, then delete that file.

## Refactors

- http: replace `createArmedDelete` (2 files).
- changes, database, notes: replace the armed signals AND stop routing confirm prompts through
  error banners — the armed button itself is the prompt.
- docker: replace both implementations; keep the pref gate via `skipConfirm`.
- agents: replace `window.confirm` for session delete; rename (`window.prompt`) should become a
  small `Modal` — prompt-for-text is not this component.
- core: `WorkspaceProjectAssignments.tsx:131` window.confirm → its existing DeleteProjectModal
  (already built) or ConfirmButton.
- github: add ConfirmButton to remove-label / remove-reviewer / close-PR, establishing the policy
  the codebase currently lacks.

## Notes

- Policy suggestion worth writing into `docs/ui-design.md` when this ships: arm-to-confirm for
  small reversible-ish deletions (a row, a chip); `Modal`/will-phase confirmation for anything with
  real blast radius (archive task, delete project, discard worktree changes).
