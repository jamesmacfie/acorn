# EmptyState

A centred "nothing here" surface with an optional explanation and action. shadcn added an Empty
component for exactly this; Bootstrap has no equivalent (which is why every Bootstrap app hand-rolls
it too). acorn's own design doc raises the bar higher than either: "Empty states explain whether a
feature is unconfigured, provider-gated, disabled, or simply has no data"
(`docs/ui-design.md`). Almost no current empty state meets that bar, because each one is a bare
`<p class="muted">`.

## Today

Around **35 sites** across the shell and every plugin, in at least ten class vocabularies:

- `.placeholder` — the closest thing to a shared class (`packages/client-core/src/styles/base.css:63`), used 12+ times in github alone (`PullDetail.tsx:204-206`, `ComparePreview.tsx:65-69`, `PullList.tsx:217`, …) and in docker/database (`DockerBrowse.tsx:305,322,346,369,393`, `DatabasePanel.tsx:219,279`)
- `.editor-empty` — defined in `plugins/editor/src/client/editor.css:6` but **also used by notes**
  (`plugins/notes/src/client/NotesPane.tsx:278,301`) — a cross-plugin CSS dependency
- `.workspace-empty-inner` — core (`packages/client-core/src/tasks/TaskPaneHost.tsx:114`), borrowed
  by preview (`PreviewPane.tsx:100,106`) and docker (`DockerBrowse.tsx:274`)
- `.http-empty`, `.http-response-empty` (`plugins/http/src/frame/HttpPanel.tsx:205,221`, `ResponseView.tsx:180`)
- `.rb-placeholder` — rollbar's `PageStatus` (`plugins/rollbar/src/frame/app.tsx:160-174`) is the
  best current shape: one component multiplexing empty / loading-with-Spinner / choose-something
- `.ln-placeholder` (`plugins/linear/src/frame/app.tsx:227-242`), `.terminal-empty`
  (`TerminalPanel.tsx:321`), `.palette-empty`, `.notify-empty`, `.repo-picker-empty`, `.finder-empty`,
  `.pr-list-connect` (the only one with an action — `plugins/github/src/client/PullList.tsx:218-227`),
  `.agent-conversation-empty` / `.managed-agent-onboarding` / `.agent-center-empty` (three different
  `✦` marks in one plugin), plus ~8 bare `<p class="muted">` in settings pages.
- The brand mark `Acorn` (`packages/client-core/src/Acorn.tsx`) is the shell's empty-pane art, and
  onboarding has to fight its centring with an override (`wizard.css:31-37`).

Loading states are the same story: no skeletons anywhere, just "Loading…" strings.

## Proposed API

```tsx
export function EmptyState(props: {
  icon?: JSX.Element            // Icon, the Acorn mark, or nothing
  title?: string                // short headline; omit for the one-liner form
  action?: JSX.Element          // a Button ("Connect GitHub", "Open a terminal")
  busy?: boolean                // loading form: renders Spinner + children as the label
  align?: 'center' | 'start'    // panes centre; sidebars and wizards start-align
  size?: 'sm' | 'md'            // sm for popover/list footers, md for panes
  class?: string
  children?: JSX.Element        // the explanation — say WHY it's empty
})
```

The `busy` form deliberately folds loading into this component (rollbar's `PageStatus` proves the
shapes are the same box): one primitive covers "loading…", "no data", and "unconfigured, do X".

## How to build it

- Component in `packages/client-core/src/ui/primitives.tsx`; CSS as `.ui-empty` in
  `packages/client-core/src/styles/primitives.css` (frame-served already).
- Centred min-height box, `--text-muted`, `--fs-sm`; `data-align`, `data-size`, `data-busy`.
- Export from `@acorn/plugin-api/ui`. Pure presentation, no imports beyond Spinner — passes the
  ui/ purity rule.
- Keep it dumb: no illustration library, no built-in reasons. The call site supplies the "why"
  text; the component supplies consistent geometry and typography.

## Refactors

- Highest value first: the ~12 github `.placeholder` sites, the docker/database `.placeholder`
  sites, and rollbar's `PageStatus` (delete the local component, keep its call sites).
- Cross-plugin dependency fixes: notes stops using editor's `.editor-empty`; preview and docker stop
  borrowing core's `.workspace-empty-inner`.
- `.pr-list-connect` becomes the reference `action` usage (`EmptyState title="Connect GitHub" action={<Button…>}`).
- The agents plugin consolidates its three `✦` empty states into one `icon` usage.
- Settings pages' bare `<p class="muted">` sites (`PluginsSettings.tsx:216`, `SecuritySettings.tsx:197`,
  `McpSettings.tsx:35`, `NodeDevices.tsx:53`, `WorkspaceExternalProjects.tsx:121`) — low urgency,
  do them as those files enter the adoption ledger.
- Loading strings ("Loading…", "Searching…", "Comparing…") migrate to `busy` where they occupy a
  pane; button-level busy stays on `Button busy`.

## Notes

- Small list-footer empties (`.palette-empty`, `.repo-picker-empty`) may stay as they are if
  wrapping them in a component fights the palette markup — judge per-site with `size="sm"`.
- See [skeleton.md](./skeleton.md) for the row-shaped loading placeholder question; EmptyState
  `busy` covers whole-pane loading, which is most of the current need.
