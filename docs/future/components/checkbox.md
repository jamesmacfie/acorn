# Checkbox

A styled, labelled checkbox — with an optional switch presentation. shadcn ships Checkbox and
Switch as separate components; Bootstrap ships Checks & radios with a `form-switch` variant. acorn
ships **nothing**: every checkbox in the app is a raw `<input type="checkbox">`, which makes it the
one class of control that no style pack can reach — a direct violation of the appearance system's
promise that packs restyle everything through tokens.

## Today

Raw checkboxes at 12+ sites, all with hand-rolled label wrappers:

- core settings: `AppearanceSettings.tsx:39-46`, `AgentToolsSettings.tsx:75-93` (including an
  `indeterminate` ref effect — the only tri-state), `PluginsSettings.tsx:223-231`,
  `WorkspaceExternalProjects.tsx:125-132`, `WorkspaceProjectSettings.tsx:329`,
  `registries/willPhase.tsx:64-72`
- plugins: `plugins/context/src/client/ContextPane.tsx:147` (styled only by a descendant
  `accent-color` rule), `plugins/agents/src/client/AgentContextPickerModal.tsx:60`,
  `plugins/database/src/frame/DatabasePanel.tsx:477` (`.db-null-toggle`),
  `plugins/docker/src/client/ContainerDetail.tsx:295` + `DockerSettings.tsx:32,38`,
  `plugins/terminal/src/client/TerminalSettings.tsx:44`,
  `plugins/github/src/client/PullDetail.tsx:338` (`.file-viewed`) + `CreatePullForm.tsx:149`,
  `plugins/http/src/frame/RequestTabs.tsx:42` + `ResponseView.tsx:81` (`.http-toggle`) +
  `HttpVariables.tsx:109`
- The repeated wrapper markup is
  `<label class="settings-field settings-field-row"><input type="checkbox"/><span class="settings-label">…</span></label>`,
  twice with an inline `padding-left: 1.5rem` nesting hack (`AgentToolsSettings.tsx:87`,
  `WorkspaceExternalProjects.tsx:124`).
- Only two sites style the box at all, via `accent-color` (`task-view.css:183`, `overlays.css:63`).

## Proposed API

```tsx
export function Checkbox(props: ComponentProps<'input'> & {
  label?: JSX.Element          // renders the <label> wrapper; omit for grid/row cells with aria-label
  hint?: string
  indeterminate?: boolean      // owns the ref effect AgentToolsSettings hand-writes
  switch?: boolean             // role="switch" + slider presentation; same element, same events
  size?: 'sm' | 'md'
})
```

One component, not two: every current site is semantically a checkbox; `switch` is presentation.
If a pack wants switches to look like iOS toggles, that's a `data-switch` selector in the pack.

## How to build it

- `packages/client-core/src/ui/primitives.tsx` + `.ui-check` in `styles/primitives.css`
  (frame-served — http/database frames need it).
- Style the native input (`accent-color: var(--accent)` gets 90% of the way and keeps native
  keyboard/screen-reader behaviour) plus a token-driven focus ring; do NOT rebuild the control out
  of divs. The switch variant can restyle the same input with `appearance: none` under
  `data-switch` only.
- `indeterminate` is a `createEffect` on the input ref — lift the exact code from
  `AgentToolsSettings.tsx:74`.
- New tokens (if any — e.g. `--check-size`) must be classified in `ui/tokenAxes.ts`.
- Export from `@acorn/plugin-api/ui`. Compose with the existing `Field` for stacked layouts;
  `label` here covers the inline "checkbox with its own caption" case that `Field` is wrong for.

## Refactors

- All core settings sites above — this also deletes the two inline `padding-left` nesting hacks
  (give `Checkbox` a `data-nested` or let the parent list own indentation).
- `willPhase.tsx:64-72` (the confirm dialog's "don't ask again") — high visibility.
- Plugin sites: context's include-toggles, database's null toggle, docker's two settings, terminal's
  settings checkbox, http's three, github's file-viewed + draft-PR, agents' context picker list.
- notes' `.notes-include-dot` (a 10px clickable on/off circle) is semantically a checkbox rendered
  as a dot — either adopt `Checkbox` with a pack-facing dot style, or keep it and note it as a
  deliberate one-off.

## Notes

- Radio groups: there are currently zero radio inputs in the codebase (choice UIs use Picker,
  Select, or segmented buttons). Skip Radio until one exists — YAGNI.
- Tri-state stays a prop, not a third component; only one site uses it.
