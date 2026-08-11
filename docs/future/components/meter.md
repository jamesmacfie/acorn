# Meter

A horizontal fill bar showing a ratio: context budget, sub-issue completion, container CPU/memory.
shadcn has Progress; Bootstrap has Progress bars. acorn has **three implementations using three
mechanisms** — a div-with-inline-width, a native `<meter>`, and an anonymous `<i>` — only one of
which is accessible and none of which share tokens.

## Today

- context: `.context-bar > .context-bar-fill` with inline `width: N%` and a `warn` class over 80%
  (`plugins/context/src/client/ContextPane.tsx:154`, `context-tray.css:44-46`); no role, no label
- linear: `.ln-subissue-bar > i` with inline width (`LinearIssueView.tsx:216`, `css:69-70`); no
  `role="progressbar"`, no label
- docker: native `<meter class="docker-meter">` for CPU/memory (`ContainerDetail.tsx:359,361`,
  `docker.css:188`) — accessible, but native meter styling is notoriously pack-hostile
  (`::-webkit-meter-*` pseudo-elements don't take CSS custom properties uniformly)

## Proposed API

```tsx
export function Meter(props: {
  value: number                 // 0..1
  tone?: 'accent' | 'warn' | 'danger' | 'auto'  // auto: thresholds at .8/.95 (context's rule)
  label: string                 // aria-label — required; all three sites currently lack one
  size?: 'sm' | 'md'
  class?: string
})
```

Div-based (`role="progressbar"` + `aria-valuenow/min/max`) rather than native `<meter>`, so style
packs can actually restyle it — the docker experience is the argument.

## How to build it

- `packages/client-core/src/ui/primitives.tsx`; `.ui-meter` in `styles/primitives.css`
  (frame-served — linear's bar is a frame consumer). Track: `--bg-sunken` + `--control-border`;
  fill: tone tokens; `data-tone`, `data-size`. Inline `--meter-value` custom property drives the
  fill width (`width: calc(var(--meter-value) * 100%)`) so the only inline style is a number.
- The `auto` tone implements context's 80% warn threshold once, with the cutoffs as constants —
  if a second site needs different thresholds, take them as a prop then.
- No animation/indeterminate mode: zero current consumers. `Spinner` covers indeterminate.
- Export from `@acorn/plugin-api/ui`.

## Refactors

- context's budget bar (keeps its ratio math, drops the class swap), linear's sub-issue bar
  (gains a role and label), docker's two meters (gains pack styling; loses nothing — the values
  are already computed).

## Notes

- Smallest doc in this folder for a reason: three consumers, one obvious shape. Good second-PR
  candidate after Alert to establish the migration rhythm.
