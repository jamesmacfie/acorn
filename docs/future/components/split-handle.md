# SplitHandle

A drag handle between two regions, with the pointer/keyboard/persistence plumbing extracted. Both
shadcn (Resizable, over react-resizable-panels) and every IDE-shaped app treat this as
infrastructure; acorn has **three independent implementations** — one good, one partial, one
plugin-local — and several splits that are fixed-width only because no handle was shareable.

## Today

- `TaskPaneHost.tsx:58-105,172-193` — the good one: pointer capture, keyboard resize
  (arrow keys), `.pane-divider` with a 5px hit area and 1px `::after` visual (`task-view.css:219-221`),
  `--z-resizer`, persists relative weights per pane id via `dispatchLayout`.
- `DocumentOverFrame.tsx:56-71,92-98` — horizontal split (`shell.css:108-114`): 6px, `ns-resize`,
  **no keyboard support, not persisted**.
- terminal drawer resize — `TerminalPanel.tsx:168-180,232` + `terminal.css:21-28`: full
  pointermove/up closure with clamping (min 160 / max 85vh) and pref persistence, again from
  scratch.
- Fixed splits that would take a handle if it were cheap: notes' 230px library
  (`notes.css:9-17`), rollbar's 32% occurrence list (`rollbar-frame.css:32`), database's clamp()
  sidebars, http's clamp() sidebar, editor's 240px side.

## Proposed API

Hook-first, per the house idiom (behaviour = hook, markup = call site — `ui/dismissable.ts:13`):

```tsx
export function createSplitDrag(opts: {
  axis: 'x' | 'y'
  value: () => number                    // current px (or fraction — caller's unit)
  onChange: (next: number) => void       // caller clamps and persists
  min?: number
  max?: () => number                     // e.g. () => window.innerHeight * .85
  step?: number                          // keyboard increment (default 16)
}): {
  handleProps: {…}                       // onPointerDown / onKeyDown / role="separator" /
                                         // aria-orientation / aria-valuenow / tabindex
}

export function SplitHandle(props: { axis: 'x' | 'y'; class?: string } & …) // thin div wrapper
```

Persistence stays with the caller (TaskPaneHost's weights, terminal's pref) — the hook only owns
drag math and the accessibility contract.

## How to build it

- `packages/client-core/src/ui/split.ts` + a `SplitHandle` component in `primitives.tsx`; CSS
  `.ui-split-handle` in `styles/primitives.css` (frame-served) with `data-axis`, hit-area padding
  around a 1px `::after` line — lifted from `.pane-divider`.
- Keyboard: arrows move by `step`, Home/End to min/max; `role="separator"` with value now/min/max.
  This upgrades DocumentOverFrame and terminal from zero keyboard support.
- Pointer capture + `user-select` suppression during drag (all three implementations solve this;
  keep TaskPaneHost's version).
- Export from `@acorn/plugin-api/ui` — plugin panes (rollbar's workbench, notes' library) are the
  next consumers.

## Refactors

- `TaskPaneHost` (donates its logic, keeps its weight model), `DocumentOverFrame` (gains keyboard),
  terminal's drawer strip (keeps its height pref + `--term-drawer-h` publication).
- Then, opportunistically, the fixed splits: notes' library and rollbar's occurrence list are the
  two users have most likely bumped into.

## Notes

- No `SplitPane` container component: acorn's splits live inside pane layouts the shell already
  owns (grid tracks, flex-basis) — a container would fight them. The handle + hook is the whole
  shareable surface. Revisit only if three call sites end up writing identical container glue.
