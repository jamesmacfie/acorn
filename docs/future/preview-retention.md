# Preserve browser previews when returning to a pane

Status: product requirements proposal, 2026-10-01. Not implemented. The reload path is identified
in source; the reported session has not been reproduced in a real window.

## Product outcome

Returning to a browser preview resumes the retained page at the location the user left. Acorn does
not navigate, reload, or recreate that page merely because the user switched panes, switched tasks,
or briefly covered the preview with an overlay. Form values, scroll position, browser history, and
page-local state survive ordinary navigation within Acorn while the browser retains its document.

Preserving a document and running it continuously in the background are separate decisions. This
feature removes Acorn's unnecessary navigation while retaining normal browser background resource
management. It does not promise indefinite preservation after a browser process is terminated or
the application exits.

This is an independent developer handoff. It can ship before the
[native overlay layer](./native-overlay-layer.md); both features use the same page-lifetime contract.

## Problem and evidence

`plugins/preview/src/client/PreviewPane.tsx` hides the shell-owned native view when the pane unmounts.
The shell retains the view in `apps/desktop/src-tauri/src/webviews.rs`. On remount, the pane calls
`preview.ensure(taskId, url)` with the Node's configured preview URL.

For a retained record with an unchanged policy, `webview_ensure` compares the current navigated URL
with that supplied URL. A mismatch calls `webview.navigate`. This confuses the configured starting
location with the user's browsing location. The shell's record contains navigation history and
policy, but no separate configured home identity.

Examples of mismatches include a user browsing from `/` to `/settings`, an application redirecting
to `/dashboard`, and a configured `http://localhost:3000` becoming the browser's normalized
`http://localhost:3000/`. The last example can trigger navigation even when the user has not browsed
away from the starting page. The renderer's preservation comment describes the intended behaviour,
but the shell does not implement it.

Leaving a pane does not deliberately destroy its preview to save memory. The shell has a shared
32-webview creation ceiling, and the preview plugin evicts an archived task's view. There is no
least-recently-used eviction policy in this module. Acorn's macOS footprint measurement covers the
main renderer and helper, and excludes host-owned child webviews.

Implemented contracts belong to [Shell](../shell.md#host-owned-webviews),
[State ownership](../state-ownership.md), and [Frontend](../frontend.md). Update those owning pages
when this feature ships.

## Scope and delivery priority

The required first delivery corrects preview reconciliation, restores toolbar state on remount,
preserves lifecycle and security rules, and measures the resource implications. It adds no automatic
application eviction timer and does not disable browser throttling globally.

The shell's `ensure` command is shared with plugin webviews. Make its meaning consistent and test
both callers. This does not require changing the plugin host's policy of evicting its page on
unmount; plugin retention is a separate product decision.

This feature does not enable remote previews, stop or start dev servers when a pane is hidden,
persist complete browser sessions across app launches, or change the preview's ephemeral storage
isolation. It introduces no Node API, database migration, plugin contribution, or persistent setting.

An application cache or memory-pressure eviction policy is a follow-up decision based on measured
resource use. It must not delay a verified fix for unnecessary navigation on ordinary returns.

## User scenarios

- A developer edits an unsaved form in the preview, opens the Changes pane, and returns. The same
  document and form remain, without a main-document request caused by Acorn.
- A developer browses a route reached through a redirect, switches to another task, and returns.
  The preview resumes that route and retains its browser history.
- A developer changes a run target to a different port. Acorn updates the preview to the changed
  configured target once, instead of treating the old browsing location as the new home.
- A developer uses **Reload** or **Home**. Those explicit controls still reload the current page or
  navigate to the configured home, respectively.

## Functional requirements

### Separate home identity from browsing state

The shell owns a retained preview record with these distinct facts:

| Fact | Purpose |
| --- | --- |
| Owner identity | Identifies the Node and task whose page this is, even if the native key grammar is unchanged. |
| Configured home | The normalized preview URL most recently accepted from the owning Node. |
| Browsing state | The current location, navigation history, and loading state of the native page. |
| Policy and validity | Decides whether the retained page may continue to exist or navigate. |
| Lifecycle generation | Rejects stale work after replacement, disposal, or owner changes. |

Normalize configured homes with the same URL parser used for native navigation before comparing
them. Preserve meaningful paths, query parameters, fragments, and ports. Do not strip URL parts or
use approximate string matching to make different targets appear equal.

When a valid retained record receives the same configured home and policy, `ensure` must perform no
navigation, reload, or creation. A different current browsing URL does not change that result.
Changes in resolution source, such as recipe versus project configuration, also do not navigate
when the normalized home is identical.

Page-driven navigation, manual address entry, redirects, and Back or Forward update browsing state.
They do not overwrite the configured home. **Home** remains an explicit navigation to that home.

### Reconciliation and navigation rules

| Trigger | Required action |
| --- | --- |
| First open with a valid resolved home | Create the native page and navigate to the home once. |
| Return to a retained page with unchanged home and policy | Restore bounds and visibility, and replay browsing state to the toolbar. |
| Overlay covers and uncovers the preview | Change composition or visibility according to the overlay host; preserve document identity. |
| Same home arrives through a refetch or URL normalization | Retain the current document and location. |
| Configured home changes | Navigate once to the changed home when the preview is next presented; do not reset merely because a resource is loading. |
| User selects **Reload** | Reload the current page explicitly. |
| User selects **Home** or submits an address | Perform the explicit navigation, independently of `ensure`. |
| Navigation grant is narrowed or revoked | Apply the existing immediate retirement and policy checks, even while hidden. |
| Task is archived or its retained owner becomes invalid | Retire the owned page and release native resources. |
| Browser loses its document or the app restarts | Use the recovery rules below; do not present the result as a preserved document. |

Validate policy before deciding to reuse a page. Preserving a document must not bypass the shell's
independent URL checks or retain a page on a revoked plugin host. Preserve the existing close-failure
invalidation behaviour.

Distinguish a pending URL read from an authoritative target change. An initial unresolved resource
may hide the page while resolving; it must not evict or navigate an otherwise valid retained record.
An authoritative absent URL may hide the preview and show its existing empty state. If the same home
returns and the record is still valid, reuse it. A switch to a remote Node retains the existing
remote-preview restriction and eviction behaviour.

Define requested and successfully applied target state so a failed native navigation remains
retryable without introducing a loop on every visibility update. Coalesce repeated reconciliation
of the same target. A stale ensure completion cannot show or repoint a replacement owner's page.

### Restore toolbar state

A returning renderer must obtain the retained page's current URL, loading state, and Back/Forward
availability after its listener is registered. It must not wait for a fresh navigation event to
populate those controls. Use an explicit state response or state replay through the existing seam;
document ordering and generation handling.

Showing a retained page does not add a history entry. Returning to a nested route must not temporarily
display the configured home in the address bar as though that were the page being shown.

### Ownership and lifecycle

Pane cleanup removes renderer observers and hides its page; it does not destroy the retained native
record. Keep the shell as the owner of browser lifetime. Avoid mounting hidden copies of the whole
pane or keeping its query listeners alive solely to preserve the page.

Reuse is scoped to the same Node and task. Task IDs alone must not cause one Node to receive another
Node's page. Verify how the task-only preview key and Node-switch cleanup satisfy this invariant
before deciding whether a transient key or record change is required.

Archiving, policy invalidation, window close, and application shutdown release retained resources.
Rapid task switches and overlapping hide/show/ensure operations must not hide the newly selected
page because cleanup from the prior owner completes late. Retain owner and generation checks across
these operations.

## Background activity and memory policy

The first delivery keeps the browser's default hidden-page scheduling policy. Acorn does not force
all hidden previews to run continuously, inject timer overrides into arbitrary pages, or request
background execution privileges merely to preserve a document.

Tauri's [background throttling documentation](https://docs.rs/tauri/latest/x86_64-apple-darwin/tauri/webview/struct.WebviewBuilder.html#method.background_throttling)
describes suspension and possible unloading of hidden pages, with platform-dependent controls.
Verify behaviour against the pinned Tauri/wry versions and the tested OS. Normal scheduling is
allowed; an Acorn-triggered navigation on each return is not.

Retaining a hidden page keeps its document, JavaScript state, and browser resources resident while
the engine retains them. Background timers, network requests, sockets, and media can have separate
CPU and network costs. Long-lived preview applications can also grow their own memory. Do not claim
that removing reloads has zero memory impact simply because the retained view count is unchanged.

Keep the shared native-view creation ceiling and archive cleanup in the first delivery. Report
capacity failures through a usable error state rather than leaving a blank rectangle or stuck
loading state. Repeated pane switches must not create additional retained records for the same owner.

Measure before selecting a different cache policy. Use a lightweight fixture and a representative
development application, with one active preview and up to five retained hidden previews. Record
the tested hardware, OS, page workload, memory, CPU, and background network activity before opening,
after hiding, after returning, and after disposal. Use a long-hidden trial as well as short switches.

Measurements must include child web-content processes and relevant browser resources. Acorn's
main-renderer metric alone is insufficient. Deduplicate shared process IDs when attributing totals,
and distinguish measured process footprint from estimates of per-page memory. Native inspection
tools are acceptable for this investigation; production telemetry expansion is optional.

Deliver a recommendation for whether the measured workload needs a smaller retained cache,
least-recently-used eviction, an inactivity policy, or explicit user controls. Any follow-up policy
must state its limits, triggers, platform support, and effect on unsaved page state. Destroying an
incognito view can also discard its storage and cookies. Do not silently implement such a policy
as part of the navigation fix.

## Document loss and recovery

Distinguish an Acorn-requested navigation, an explicit user reload, a page-requested reload or dev
server hot update, and browser document loss. The browser can lose a content process independently;
[WebKit provides a termination notification](https://developer.apple.com/documentation/webkit/wknavigationdelegate/webviewwebcontentprocessdidterminate(_:)).

When the engine reports document loss, recover once through a validated location if the engine
requires navigation. Prefer the last known browsing location for a retained owner; use the configured
home if no valid browsing location is available. Recovery must not loop, resurrect a revoked page,
or replay form submissions or user actions. A crash or engine unload cannot guarantee restoration
of JavaScript state, form values, or the complete native history.

Provide a quiet explanation when Acorn knows it had to recover or recreate a page, with a retry
control on failure. If the backend cannot observe a particular loss condition, document that limit
and avoid inventing a recovery reason. Do not interrupt every ordinary return with a notice.

Diagnostics may include lifecycle reason, owner generation, navigation count, and duration. Exclude
page contents, credentials, form data, and full URLs containing private query values. Preserve the
existing telemetry consent rules.

## Architecture and data flow

The Node remains authoritative for preview configuration. Its URL resolution proceeds through the
recipe, default run target, and project configuration ladder. The renderer reads that result through
the existing API, protocol, and custody broker, then asks the platform preview seam to reconcile a
native page. The shell owns configured home identity and browsing state across renderer remounts.

Keep this transient browser state outside the client query cache and the Node database. URL refetch
means checking configuration; it is not a request to reload the browser. The renderer cannot read
native handles, and the previewed page receives no additional bridge authority.

The primary change belongs in shell reconciliation. Update the platform seam and renderer only as
needed for state replay and scoped lifecycle handling. Test shared `ensure` behaviour with plugin
webviews, including policy replacement and intentional unmount eviction. The terminal host continues
using its existing preview capability gate.

## Acceptance scenarios

| ID | Scenario | Pass condition |
| --- | --- | --- |
| R1 | Open a slashless configured URL, leave, and return. | Same document remains; normalization causes no extra navigation. |
| R2 | Browse to a nested route or follow a redirect, leave, and return. | Same route, document, form values, scroll position, and history remain while the engine retains the page. |
| R3 | Make 50 short pane switches and repeated same-home refetches. | Acorn causes zero additional main-document navigations, creations, or history entries after the initial load. |
| R4 | Switch between two local tasks with different previews. | Each resumes its own retained document; view count remains one per retained owner. |
| R5 | Cover and uncover a preview through an overlay. | Visibility reconciliation does not navigate or recreate the document. |
| R6 | Change the configured target port or meaningful URL component. | One intended navigation applies the changed home; stale completions do not restore the prior target. |
| R7 | Change URL-resolution source while the normalized home stays equal. | No browser navigation occurs. |
| R8 | Return without any page navigation event. | Address, loading indicator, and history controls immediately reflect retained shell state. |
| R9 | Use **Reload**, **Home**, address entry, Back, and Forward. | Explicit controls work; browsing location and configured home remain separate. |
| R10 | URL resolution is pending, absent, invalid, or returns an error. | Retained pages are not reset by a pending read; empty/error states are usable; invalid grants cannot preserve access. |
| R11 | Archive a task, revoke a plugin host, switch Node, or close the window. | Relevant records are retired; no cross-owner reuse or late reappearance occurs. |
| R12 | Native navigation fails or tasks switch during ensure. | Failure is retryable, retries do not loop, and stale operations cannot show or hide the wrong page. |
| R13 | Browser reports document loss after a long hidden interval. | Recovery is bounded and policy-checked; known state loss is explained without claiming preservation. |
| R14 | Reach the shared native-view ceiling. | A usable capacity error appears; no unbounded creation or silent unsaved-state eviction occurs. |
| R15 | Run plugin page lifecycle and policy-replacement checks. | Shared reconciliation is correct; plugin unmount eviction and sandbox rules remain intact. |

## Verification and delivery

First reproduce the slashless URL, nested-route, and redirect cases in a real Tauri window. Use a
fixture with a document incarnation marker, an unsaved form, a scrollable region, and observable
navigation requests. Separate main-document loads from asset requests, normal application fetches,
and dev server hot updates so the test does not mistake legitimate activity for Acorn navigation.

Implement and unit-test the pure reuse-versus-navigation decision. Cover normalized homes, browsing
state, policy changes, failed navigation, repeated ensures, and stale generations. Add renderer/seam
tests for state replay and owner cleanup. Recheck plugin callers of the shared command.

Run `pnpm lint`, relevant preview and client-core tests, and `pnpm --filter @acorn/desktop test`.
Use `pnpm test` for the complete suite so its concurrency remains bounded.

For graphical acceptance, start `pnpm dev:agent -- --session preview-retention`, take renderer
snapshots after transitions with `pnpm dev:agent:ui -- --session preview-retention snapshot`, and
capture screenshots. Use native control or manual interaction for the child preview: the agent
driver does not inspect or operate that native page. Finish with
`pnpm dev:agent:ui -- --session preview-retention stop`.

Hand off acceptance results, navigation traces, resource measurements, a platform recovery matrix,
and the recommendation for any follow-up eviction policy. Update the owning shell and testing docs
to describe shipped behaviour, and coordinate the lifetime contract with the native overlay work.

## Verify before building

Paths identify owners, not frozen APIs. Recheck the implementation and adjacent tests before editing.

- `apps/desktop/src-tauri/src/webviews.rs`: configured-home omission, navigation history, shared
  `ensure`, policy replacement, native resource ceiling, and hide/evict operations.
- `plugins/preview/src/client/PreviewPane.tsx` and
  `plugins/preview/src/client/PreviewTaskPane.tsx`: remounts, pending resources, repeated ensure,
  generation checks, toolbar event subscription, and cleanup ordering.
- `plugins/preview/src/server/previewUrls.ts`: authoritative URL resolution and source changes.
- `plugins/preview/src/client/index.ts`: task-archive eviction and preview contributions.
- `apps/desktop/src/shell/bridge.ts`, `packages/client-core/src/infra/platform/index.ts`, and
  `packages/client-core/src/infra/platform/contract.ts`: preview identity, native command projection,
  state replay options, and seam contract tests.
- `packages/client-core/src/host/frames/PluginWebview.tsx`: shared command semantics and intentional
  plugin page eviction on unmount.
- `packages/client-core/src/infra/node/tunnelUrl.ts`: Node ownership and remote-preview restrictions.
- `apps/desktop/src-tauri/src/footprint.rs`: child-process measurement gap and attribution limits.
- Confirm pinned browser scheduling and process-loss hooks, native history visibility, Node-switch
  cleanup, and the shared creation-ceiling error path on the tested desktop platforms.
