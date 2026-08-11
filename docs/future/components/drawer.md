# Drawer

A side-anchored dismissable panel: the checks log slides in from the right; a future detail
inspector might too. shadcn has Sheet (and Drawer via Vaul); Bootstrap has Offcanvas. acorn has
one hand-rolled right drawer that bypassed the shared dismissal machinery, and one bottom drawer
that is genuinely its own thing.

## Today

- github's ChecksPanel: `Portal` → `.checks-panel-backdrop` + fixed `aside.checks-panel`, its own
  Escape handler, its own close ✕ — hand-rolling exactly what `Modal`/`createDismissable` provide
  (focus trap included, which it currently lacks)
  (`plugins/github/src/client/checks/ChecksPanel.tsx:75-120`, `checks-panel.css:3-19`)
- terminal's bottom drawer: portalled, fixed, drag-resizable, publishes its height as
  `--term-drawer-h` so panes shrink (`TerminalPanel.tsx:229-232,165-166`) — persistent workspace
  chrome, NOT a dismissable overlay; it should not migrate to this component.
- The shell's overlay slot machinery (`SlotHost "drawer"` in `App.tsx:433`) already names the
  concept.

## Proposed API

```tsx
export function Drawer(props: {
  onClose: () => void
  side?: 'right' | 'left' | 'bottom'
  size?: 'sm' | 'md' | 'lg'            // clamp-based width/height per side
  title?: string                        // header row with close button
  dismissOn?: readonly ('escape' | 'backdrop')[]
  labelledBy?: string
  class?: string
  children: JSX.Element
})
```

Modal's sibling, not its child: same `createDismissable` behaviour core, same backdrop class
family, different geometry (edge-anchored, full-height, slide transition).

## How to build it

- `packages/client-core/src/ui/Drawer.tsx` beside `Modal.tsx`; behaviour is
  `createDismissable({ onDismiss, container, on })` verbatim — that hook exists precisely so
  surfaces like this are "purely cosmetic and therefore safely reviewable" (`Modal.tsx:5-6`).
- CSS in `styles/overlays.css` (frame-served): `.overlay-backdrop` reused; `.ui-drawer` with
  `data-side`, `data-size`; z from the existing `--z-modal` band; slide transition behind the
  motion tokens with a reduced-motion guard.
- `role="dialog" aria-modal="true"`, focus trap from the hook, focus return on close.
- Export from `@acorn/plugin-api/ui`.

## Refactors

- ChecksPanel — the only migration, and a full win: −40 lines of hand-rolled portal/escape/backdrop,
  +focus trap it never had. Its step accordion and log viewer stay
  ([collapsible-section.md](./collapsible-section.md), [code-block.md](./code-block.md) cover
  those separately).
- Terminal's drawer: explicitly out of scope (resizable persistent chrome with height
  publication); note in the JSDoc so nobody tries.

## Notes

- One consumer today. This doc exists because the *second* consumer is predictable (reference
  panels, occurrence inspectors) and because the one consumer currently lacks a focus trap — a
  correctness gap, not just DRY. If reviewers disagree, fold Drawer into `Modal` as
  `anchor='right'` — the CSS is the only real difference; the repo's build-the-seam-anyway
  posture says the separate name is clearer.
