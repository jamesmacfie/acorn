# DocumentTabs

A tab strip for *documents*: closable, reorderable-ish, with dirty/status indicators and an
overflow scroll. This is deliberately a different component from the existing `Tabs` (which
switches panels and stays simple); VS Code-style editor tabs have different affordances — close
buttons, ephemeral/preview italics, dirty dots — and both places that need them have forked
rather than bend `Tabs`.

## Today

- editor: `.editor-tabs` strip 25 lines below a shared-`Tabs` usage in the same file —
  `.editor-tab` with `classList={{active, ephemeral}}`, name button + `✕` close button, dirty
  state as a string concat `' ●'`, plus a right-hand `.editor-tab-actions` slot
  (`plugins/editor/src/client/EditorPane.tsx:284-322`, `editor.css:126-159`)
- terminal: `.terminal-tab` strip — active underline via `--tab-active-w`, status dot
  (running/exited/idle), idle micro-badge, close `✕`, pending shimmer tab, horizontal scroll;
  **no tablist/tab roles, no arrow-key nav, no roving tabindex**
  (`plugins/terminal/src/client/TerminalPanel.tsx:236-269`, `terminal.css:39-105`)
- github's `.pr-tabs` (`PullList.tsx:201-209`) looks similar but is two static tabs + a filter —
  that one should become shared `Tabs` + `Toolbar`, not this.

## Proposed API

```tsx
export type DocTabDef = {
  id: string
  label: string
  dirty?: boolean               // ● dot
  status?: 'ok' | 'warn' | 'muted'   // terminal's run-state dot (StatusDot tones)
  ephemeral?: boolean           // preview-tab italics
  pending?: boolean             // terminal's launching shimmer
  title?: string
}

export function DocumentTabs(props: {
  tabs: readonly DocTabDef[]
  active: string
  onActivate: (id: string) => void
  onClose?: (id: string) => void        // middle-click too
  actions?: JSX.Element                 // right-pinned slot (editor's tab actions)
  idPrefix: string
  ariaLabel: string
})
```

Same contract shape as `Tabs` (tablist only, panels are the caller's; ids follow the
`${idPrefix}-tab-${id}` convention) so the two components feel like siblings.

## How to build it

- `packages/client-core/src/ui/DocumentTabs.tsx`; `.ui-doctabs` / `.ui-doctab` in
  `styles/tabs.css` (already a role sheet, already frame-served).
- Lift the ARIA/roving-focus code from `Tabs.tsx` (arrow keys, `aria-selected`, tabindex
  management). Close buttons are separate focusables INSIDE the tab with `aria-label="Close X"`;
  Delete/middle-click close when `onClose` present.
- Dirty/status render via [StatusDot](./status-dot.md); pending shimmer must respect
  `prefers-reduced-motion` (terminal's current keyframes don't).
- Horizontal overflow scrolls (terminal's `.terminal-tabstrip` behaviour); active tab scrolls into
  view on change.
- Export from `@acorn/plugin-api/ui`.

## Refactors

- editor's tab strip — deletes ~35 lines of markup and the string-concat dirty dot; its
  `.editor-tab-actions` becomes the `actions` slot.
- terminal's tab strip — the big accessibility win (gains all the ARIA it currently lacks); its
  idle badge stays as a `label` suffix or a small custom render — if that fights, add a
  `trailing?: (tab) => JSX.Element` escape hatch rather than growing DocTabDef.
- Do NOT migrate `.pr-tabs` here (→ `Tabs`), nor the TabRail (vertical, icon, drag-reorder — its
  own world).

## Notes

- Drag-to-reorder: terminal doesn't have it, editor doesn't have it; skip until a consumer asks.
- If `Tabs` gains an `actions` slot (see README extensions), DocumentTabs should share the slot's
  CSS so right-pinned controls align across both strips.
