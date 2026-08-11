# Popover

An anchored floating surface: the primitive under menus, pickers, autocompletes, and rich
tooltips. shadcn's Popover (over Radix) and Bootstrap's Popovers both exist because anchoring is
the hard, shared part — portal, position-to-rect, reflow on scroll/resize, outside-click, Escape.
acorn has solved that problem well **once**, inside `Picker`, and then solved it badly or partially
four more times.

## Today

Four anchoring strategies in circulation:

- `packages/client-core/src/ui/Picker.tsx:48-107` — the good one: Portal + `position: fixed` to the
  trigger's `getBoundingClientRect()`, repositions on open/scroll(capture)/resize, outside-click
  aware of the portalled element, Escape closes. Its own comment says: "The anchoring below is
  deliberately NOT extracted into a shared hook: it has exactly one consumer… Extract it if a
  second element-anchored popover appears." Several have appeared.
- `packages/client-core/src/ui/MentionTextarea.tsx:122-146` — Portal + fixed, anchored to a
  textarea (caret-adjacent), its own listeners.
- `AccountMenu.tsx:47-70` and `NotificationBell.tsx:43-129` — plain CSS `position: absolute` below
  the trigger; each hand-rolls its own outside-click document listener.
- `TabRail.tsx:356-377` — `position: absolute; left: 100%`, **no outside-click, no Escape**.
- `plugins/terminal/src/client/TerminalPanel.tsx:275-301` — the buggiest: absolute-positioned menu
  with a full-viewport backdrop div for click-away, no Escape, no focus management, **no portal, so
  any `overflow` ancestor clips it** — precisely the failure `Picker.tsx:9-13` documents.
- agents adds two more one-offs: a CSS-`:hover` tooltip panel (`AgentUsageIndicator.tsx:21`) and an
  absolutely-positioned `<details>` preview (`AgentComposer.tsx:455`).

## Proposed API

Two layers, following the dismissable idiom (behaviour = hook, markup = call site):

```tsx
// ui/anchor.ts — the extracted Picker anchoring
export function createAnchoredPopover(opts: {
  anchor: () => HTMLElement | undefined
  placement?: 'bottom-start' | 'bottom-end' | 'top-start' | 'right-start'
  minWidth?: number | 'anchor'      // Picker's max(rect.width, 300)
  onDismiss: () => void             // outside-click + Escape, portal-aware
}): {
  open: () => boolean
  toggle: () => void
  position: () => { top: number; left: number; width?: number }
  // spread targets for the popover root (ref + style + listeners)
}

// ui/Popover.tsx — thin component for the common case
export function Popover(props: {
  trigger: (open: () => boolean, toggle: () => void) => JSX.Element
  placement?: …
  class?: string
  children: JSX.Element
})
```

## How to build it

- Extract the hook from `Picker.tsx` nearly verbatim into `packages/client-core/src/ui/anchor.ts`;
  refit `Picker` on top of it in the same change so there is exactly one implementation the day it
  lands.
- `.ui-popover` in `styles/primitives.css`: `--radius-popover`, `--shadow-popover` (terminal's menu
  already reaches for `--shadow-4`; standardise), `--z-picker`-family z token from the existing
  ladder in `ui/tokenAxes.ts` — never a raw z-index (`cssHygiene.test.ts`).
- Focus: reuse `createListNavigation`/`trapOverlayFocus` from `ui/focus.ts` where the content is a
  list; the hook itself only owns dismissal and position.
- Frame caveat: inside a sandboxed plugin frame the "viewport" is the frame, so fixed-positioning
  works unchanged — export from `@acorn/plugin-api/ui`.

## Refactors

- `Picker` (refit, no behaviour change), `MentionTextarea` (drop its private listeners).
- `AccountMenu`, `NotificationBell`, `TabRail`'s task context menu — these three become
  [Menu](./menu.md) consumers, which builds on this.
- Terminal's profile menu — the highest-value fix (gains portal, Escape, ARIA).
- agents' usage tooltip panel (hover-CSS → Popover with hover-intent, or stays a
  [Tooltip](./tooltip.md) if it loses interactivity) and the composer context preview.

## Notes

- Don't add flip/collision middleware beyond what Picker has today (a `placement: top` flag and
  viewport re-measure). If a real collision case appears, extend then.
- The overlay palettes (⌘K/⌘P) are NOT popovers — they're centred surfaces owned by
  `createOverlayPalette`; see [palette-surface.md](./palette-surface.md).
