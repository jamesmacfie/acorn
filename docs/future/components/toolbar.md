# Toolbar

A horizontal strip of controls with consistent gap, padding, bottom border, and an alignment
model. Bootstrap has Button toolbar; shadcn leaves it to layout. acorn has drawn this exact strip
at least **fifteen times** — flex row + `gap` + `border-bottom` + `--bg-subtle` — and aligns
right-hand items with ad-hoc `margin-left: auto`, twice as inline styles.

## Today

- plugins: `.notes-toolbar` (`notes.css:65-73`), `.terminal-tabs`' action region
  (`terminal.css:32-38`), `.preview-chrome` (owned by CORE's `task-view.css:89` even though only
  the preview plugin renders it), `.http-urlbar` + `.http-metabar` (`http.css:116,126`),
  `.db-editor-bar` + `.db-result-bar` (`database.css`), `.docker-logs-bar` + `.docker-filters` +
  `.docker-object-bar` (`docker.css`), `.agent-composer-actions` + `.agent-queued-actions`
  (`managed-agents.css`), `.changes-toolbar` (`changes.css`), `.search-toggles` region
  (`search.css:31`), `.diff-toolbar` (`client-core/styles/diff.css:230`), `.pr-tabs` (tabs + filter
  crammed into one bar, `pull-list.css:17`)
- core: `.pane-slot-actions` (`task-view.css:222`), `.repo-picker-tools` (`topbar.css:119`),
  `.settings-actions` (`settings.css:90`), `.integration-actions`, `.node-actions`,
  `.plugin-actions`, `.ws-row-actions`, `.close-actions`, `.ui-modal-actions` (the one that IS
  shared, `primitives.css:187`)
- Alignment hacks: `style={{ 'margin-left': 'auto' }}` inline at `ContextPane.tsx:232` and
  `DockerBrowse.tsx:266`; `justify-content: flex-end` restated per-bar elsewhere.

## Proposed API

```tsx
export function Toolbar(props: {
  variant?: 'bar' | 'actions'   // bar: bordered strip on --bg-subtle (pane toolbars);
                                // actions: borderless end-aligned row (form/modal footers)
  size?: 'sm' | 'md'
  class?: string
  children: JSX.Element
})
Toolbar.Spacer = () => <span class="ui-toolbar-spacer" />   // flex:1 — the margin-left:auto killer
Toolbar.Group = (props) => …    // gap-tightened cluster (find-bar's prev/next pair)
```

`role="toolbar"` + `aria-label` on the bar variant. No arrow-key roving by default — most acorn
toolbars mix inputs and buttons where roving hurts; add it later behind a prop if a pure-button
bar wants it.

## How to build it

- `packages/client-core/src/ui/primitives.tsx`; `.ui-toolbar` in `styles/primitives.css`
  (frame-served). Tokens: `--space-*` gaps, `--divider` bottom border, `--bg-subtle`. `data-variant`,
  `data-size`.
- This is intentionally a *layout* primitive: almost no behaviour, high leverage — every style
  pack currently has zero say over fifteen separately-authored bars; after this, density packs
  compress every toolbar through one rule.
- `Toolbar variant="actions"` subsumes `Modal.Actions`' role; keep `Modal.Actions` as an alias
  (it can render `Toolbar` internally) so no migration is forced.
- Export from `@acorn/plugin-api/ui`.

## Refactors

- Start where the inline styles are: `ContextPane.tsx:216-233` (sync row) and docker's header
  region — `Toolbar.Spacer` replaces both `margin-left:auto` hacks.
- notes toolbar, http urlbar/metabar, database's two bars, docker's three bars, changes' header
  strip, agents' composer/queued bars.
- Core: `.settings-actions` and friends when their files are touched; `.repo-picker-tools`
  inside Picker.
- `.pr-tabs` should split into `Tabs` + `Toolbar` (it is currently both at once).
- Leave `.preview-chrome` until preview's CSS moves into the plugin (flagged in the survey as an
  ownership inversion); then it becomes a Toolbar.

## Notes

- Do not absorb tab strips or the topbar: tabs have their own semantics, and the topbar is shell
  chrome with a grid layout, not a toolbar.
