# Tooltip

Hover/focus hint text. shadcn has Tooltip; Bootstrap has Tooltips. acorn already has something
*better* than both for its main case — the delegated singleton in
`packages/client-core/src/tooltip/RailTips.tsx` — but it is used by exactly one plugin and a
handful of core sites, while ~50 other sites fall back to native `title=`, which is slow,
unstyled, invisible to keyboard users on some platforms, and inconsistent with the styled tips
sitting next to them.

## Today

- `RailTips.tsx` (119 lines): one delegated `mouseover`/`focusin` listener on `[data-tip]`, a
  singleton fixed-position bubble, automatic side flip, `data-tip-sub` for a second line,
  `data-tip-key` for a kbd chord, `data-tip-legend` for a JSON status legend. CSS
  `tooltip/rail-tips.css`. Producers: `TabRail`, `TaskPaneHost`, `TaskView`,
  `WorkspaceProjectAssignments`, and *one* plugin — changes (`ChangesPane.tsx:196-200,247-260`).
- Native `title=` everywhere else: ~30 core sites (`NodeChip.tsx:29`, `SettingsModal.tsx:62`,
  `McpSettings.tsx:48`, `IconPicker.tsx:49`, …) and effectively all plugins (github, docker,
  editor, notes, database use `title=` exclusively). `WorkspaceProjectAssignments.tsx:316-318`
  even has a comment acknowledging `title` is the inferior option.
- One rogue implementation: agents' hover-CSS tooltip panel
  (`AgentUsageIndicator.tsx:21-23`, `agent-usage.css:15-37`) — interactive content, so really a
  [Popover](./popover.md), not a tooltip.
- Keyboard hints are also smuggled into titles ("Previous match (⇧⏎)" —
  `plugins/github/src/client/DiffToolbar.tsx:38`) instead of `data-tip-key`.

## Proposal

Not a new component — a **promotion**. The attribute protocol is the right design for a dense app
(no wrapper elements, no per-site listeners, works on any element including plugin-contributed
markup). What's missing is: a shared home, a documented contract, and frame support.

1. Move `RailTips.tsx` + `rail-tips.css` to `packages/client-core/src/ui/tips.tsx` (rename: it
   outgrew the rail long ago) and mount it once from the shell root. Document the four attributes
   (`data-tip`, `data-tip-sub`, `data-tip-key`, `data-tip-legend`) as the app's tooltip contract in
   `docs/ui-design.md`.
2. Export nothing component-shaped for the host case — attributes are the API. Optionally export a
   tiny typed helper so call sites get completion:
   ```tsx
   export const tip = (text: string, opts?: { sub?: string; key?: string }) =>
     ({ 'data-tip': text, 'data-tip-sub': opts?.sub, 'data-tip-key': opts?.key })
   // <Button {...tip('Rebuild', { key: '⌘R' })}>
   ```
3. Frames: a sandboxed frame has its own document, so the shell singleton can't see it. Ship the
   same delegated listener as a frame-side helper on `@acorn/plugin-api/ui` (it is pure DOM — no
   shell imports — so it passes the barrel rules), mounted by the frame root the way frames already
   mount their own CSS.
4. Keep native `title=` acceptable ONLY where the styled tip can't reach (e.g. inside xterm's
   canvas region) — say so in the doc.

## Refactors

- Mechanical: swap high-traffic `title=` sites to `data-tip` — pane chrome (`TaskPaneHost.tsx:148,159`),
  `NodeChip`, settings close buttons, github's toolbar buttons (moving their "(⇧⏎)" suffixes to
  `data-tip-key`), docker's row actions, editor's tab close buttons.
- agents' `AgentUsageIndicator` hover panel → Popover (interactive content must be hoverable and
  focusable; a tooltip is not).
- The `data-tip-legend` JSON payload is currently styled partly by github's CSS
  (`.checks-dot` — see [status-dot.md](./status-dot.md)); fixing StatusDot fixes the legend.

## Notes

- Delay/motion: keep the current singleton's timing; expose `--tip-delay` as a style token only if
  a pack asks. Reduced-motion already has a token vocabulary — honour it for the fade.
- Don't build a wrapper `<Tooltip>` component: wrappers change layout (a new element around the
  trigger), which is exactly what the attribute protocol avoids.
