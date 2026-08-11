# FindBar

An in-content search strip: input, match counter (`3/17`), prev/next, option toggles, close. No
shadcn/Bootstrap equivalent — this is an editor-app pattern (VS Code's find widget) — and acorn
has built it three times with three keyboard models.

## Today

- github diff find: `.diff-find` `role="search"` — input, `.diff-find-count`, prev/next/`Aa`/close
  buttons with literal `↑ ↓ ✕` glyphs, chords documented only in `title=`
  (`plugins/github/src/client/DiffToolbar.tsx:19-50`)
- docker logs find: `.docker-logs-bar` — follow checkbox, input with Enter/Shift+Enter/Escape
  handling, `n/N` counter, prev/next, Clear, live/ended status; manual `indexOf` scan producing
  `<mark>` segments (`plugins/docker/src/client/ContainerDetail.tsx:292-347`)
- editor find-in-files: `.search-panel` — input + three toggles + status line; a different beast
  (it queries the worktree, not the visible content) but shares the toggle strip and status-line
  anatomy (`plugins/editor/src/client/search/SearchPanel.tsx:67-91`)
- Two highlight vocabularies for matches: `.search-mark` (`search.css:124`) vs
  `.diff-find-hit`/`.diff-find-current` (`diff.css:267-268`), plus docker's `.current` mark.

## Proposed API

```tsx
export function FindBar(props: {
  query: string
  onQuery: (q: string) => void
  count?: { current: number; total: number }   // renders "3/17"; omit while idle
  onNext: () => void
  onPrev: () => void
  onClose?: () => void
  toggles?: JSX.Element          // SegmentedControl/ToggleButtons (Aa, \b, .*, follow)
  status?: JSX.Element           // docker's live/ended, editor's truncation note
  placeholder?: string
  class?: string
})
```

Owns the keyboard contract so all three surfaces finally agree: Enter → next, Shift+Enter → prev,
Escape → close (or clear-then-close), chords rendered via [Kbd](./kbd.md) in tooltips instead of
title strings. Matching/highlighting stays entirely at the call site — the bar is chrome.

## How to build it

- `packages/client-core/src/ui/FindBar.tsx`; `.ui-findbar` in `styles/primitives.css`
  (frame-served). Composes `Input kind="filter"`, `Button variant="bare" iconOnly` with real
  `Icon`s (chevron-up/down/x), and [Toolbar](./toolbar.md) geometry.
- `role="search"` on the container; the count is `aria-live="polite"`.
- Also standardise the match-highlight class while here: one `.ui-find-mark` (+`[data-current]`)
  rule in `primitives.css`, replacing the three vocabularies — callers apply it to their own
  `<mark>` elements.
- Export from `@acorn/plugin-api/ui`.

## Refactors

- github's DiffToolbar find region (keep the view-mode segmented control beside it — see
  [segmented-control.md](./segmented-control.md)).
- docker's logs bar (its follow checkbox and Clear button ride in `toggles`/`status` slots; its
  matcher stays).
- editor's SearchPanel header row adopts the bar for input+toggles+status; its grouped results
  list is its own thing.
- Migrate the three mark classes to `.ui-find-mark`.

## Notes

- Skip regex/whole-word logic in the component — the three consumers have three different
  matchers (diff model pass, plain indexOf, ripgrep); FindBar must not care.
