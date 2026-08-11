# Alert

Inline feedback with a tone: an error under a form, a warning banner above a list, a status
notice after an action. shadcn calls this Alert; Bootstrap splits it into Alerts and (partly)
Callouts. acorn has no component for it, and the gap is the single most duplicated pattern in the
codebase — and the one place where the dependency graph is outright inverted.

## Today

`.action-error` is the de-facto shared error class. It is used in **32 TSX files** — 17 of them in
`packages/client-core` (TabRail, settings pages, dialogs, palettes, TaskView) and the rest across
plugins (agents, changes, notes, onboarding, editor, github) — but it is **defined only in
`plugins/github/src/client/styles/pull-detail.css:140`** (restated in `pull-list.css:114`).
Disabling the GitHub plugin unstyles every error message in the shell. Shared libraries may not
import plugin CSS (`tools/arch/boundaries.test.ts`), so core cannot fix this without a new owner.

Beyond `.action-error`, each surface has invented its own spelling:

- `.rb-error` — rollbar frame, bordered box with `role="alert"` (`plugins/rollbar/src/frame/app.tsx`, `RollbarItemView.tsx`, `index.tsx`)
- `.ln-error` — linear frame, doing double duty as page banner and inline field error (`plugins/linear/src/frame/LinearIssueView.tsx`)
- `.http-response-error`, `.http-failure-message`, `.http-frame-error` — three flavours in one plugin (`plugins/http/src/frame/ResponseView.tsx`, `index.tsx`)
- `.db-error` — database frame, four duties incl. bootstrap failure (`plugins/database/src/frame/DatabasePanel.tsx:212`, `index.tsx:25`)
- `.terminal-error-banner`, `.terminal-unavailable` — terminal (`plugins/terminal/src/client/TerminalPanel.tsx:315, :235`)
- `.settings-error`, `.agent-usage-route-error`, `.agent-error-card` — agents (`plugins/agents/src/client/AgentPricingSettings.tsx:162`, `AgentUsageSection.tsx:34`, `AgentEventCard.tsx:158`)
- warning callouts with the same shape: `.settings-notice` (`packages/client-core/src/settings/PluginsSettings.tsx:169`, `SecuritySettings.tsx:145`), `.fleet-banner` (`packages/client-core/src/node/FleetHome.tsx:67`), `.notify-banner` (`NotificationBell.tsx:60`), `.docker-stale-banner` (`plugins/docker/src/client/DockerBrowse.tsx:297`), `.agent-center-banner` (`plugins/agents/src/client/AgentCenter.tsx:178`), `.plugin-webview-blocked` (`packages/client-core/src/plugins/frames/PluginWebview.tsx:129`)
- and the anti-pattern: `plugins/workflows/src/client/WorkflowsSettings.tsx:52` renders warnings as
  muted grey text with a literal `⚠`, and `plugins/memory/src/client/MemorySection.tsx:107` shows
  success and failure through the same unstyled muted span.

Three different `role` values are in circulation (`alert`, `status`, none), chosen inconsistently.

## Proposed API

```tsx
export function Alert(props: {
  tone?: 'danger' | 'warn' | 'info' | 'success'
  variant?: 'inline' | 'banner'   // inline: text-weight error line; banner: bordered callout box
  title?: string                  // banner form: bold lead (rb-error's <strong>)
  actions?: JSX.Element           // banner form: an inline Button ("Restart node", "Refresh")
  onDismiss?: () => void          // optional ✕; most current sites don't have one
  class?: string
  children: JSX.Element
})
```

- `role` is derived, not passed: `danger` → `role="alert"`, everything else → `role="status"`.
- `inline` matches today's `.action-error` (red text, no box) so migration is a class-for-class swap.
- `banner` matches `.settings-notice`/`.fleet-banner`/`.docker-stale-banner` (warn-toned bordered
  box, optional action button).

## How to build it

- Component in `packages/client-core/src/ui/primitives.tsx` (it is pure presentation — props in,
  DOM out — so it belongs beside Badge/Spinner, and the ui/ purity rule in
  `tools/arch/boundaries.test.ts` holds).
- CSS in `packages/client-core/src/styles/primitives.css` as `.ui-alert` with `data-tone` and
  `data-variant`, colours via the existing theme tokens (`--danger`, `--warn`, `--accent`,
  `--notice-*` if present) — never literals; `cssHygiene.test.ts` enforces this.
- `primitives.css` is already on the frame stylesheet allowlist
  (`apps/desktop/src/app/main/pluginFrameStyles.ts`), so rollbar/linear/http/database frames get it
  with no distribution work. This is the mechanism that retires `.rb-error`/`.ln-error` re-declarations.
- Keep `props.class` appended via `cx()` — `adoption.test.ts` requires the passthrough, and it lets
  a migrated call site keep its old class during the transition.
- Export from `@acorn/plugin-api/ui` (frame-safe barrel).
- Add `.action-error` to the retired-class regex in
  `packages/client-core/src/ui/adoption.test.ts:40` once shell call sites are migrated.

## Refactors

First wave (fixes the inverted dependency — highest priority in this whole folder):

- All 17 client-core `.action-error` sites: `tabs/TabRail.tsx:386,402`, `settings/WorkspaceProjectSettings.tsx:294,413`, `settings/PluginsSettings.tsx:180`, `settings/NodesSettings.tsx:228,285`, `settings/IntegrationsSettings.tsx:219`, `settings/ShortcutsSettings.tsx:116,144`, `settings/SecuritySettings.tsx:192`, `settings/WorkspaceExternalProjects.tsx:76`, `plugins/PluginTrustDialog.tsx:198`, `plugins/chrome/ChromeSourcePanel.tsx:150`, `workspaces/WorkspaceProjectAssignments.tsx:142`, `configTrust/ConfigTrustDialog.tsx:70`, `integrations/PromoteToTaskModal.tsx:122`, and the palette/task/editor-surface sites.
- Plugin `.action-error` sites: agents (`AgentPane.tsx:368`, `AgentComposer.tsx:476`, `AgentCenter.tsx:174`, `AgentRequestCard.tsx:101`), changes (`ChangesPane.tsx` header), notes (`NotesPane.tsx:277`), onboarding (`OnboardingWizard.tsx:210,326`, `GithubConnect.tsx:58`), editor (`EditorPane.tsx:320`), memory (`MemorySection.tsx:73`).
- Then delete the rule from `pull-detail.css` / `pull-list.css`.

Second wave (frames and banners):

- rollbar `.rb-error` (three sites), linear `.ln-error`, http's three error classes, database `.db-error`.
- Banner variant: `.settings-notice`, `.fleet-banner`, `.notify-banner`, `.docker-stale-banner`, `.agent-center-banner`, `.plugin-webview-blocked`, terminal's two banners.
- workflows' muted-⚠ list and memory's muted-span success message become `Alert tone="warn"` / `tone="success"` `variant="inline"`.

## Notes

- Do not fold transient feedback ("Saved", "Copied") into Alert — that is [Toast](./toast.md).
- The linear frame uses `.ln-error` as a *field* error too; those sites should move to `Field`'s
  existing `error` prop, not to Alert.
