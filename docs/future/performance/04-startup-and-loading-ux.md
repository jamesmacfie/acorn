# Phase 04: Explain startup progress and recover loading failures

Date: October 9, 2026. Status: planned. Depends on: phase 01.
Source baseline: `989b069c389df6143b90ffb9889dfeaae5db6010`.

Show changing loading messages for the actual startup stage, and keep a pending feature visible as
a labelled placeholder. Preserve saved destinations and layouts while adding retryable failure states.

## Starting point and owners

`apps/desktop/src/client/App.tsx` gates the shell with Node readiness, query-cache restoration, and
compiled plugin readiness, using `NodeGate` as the fallback for all three.
`packages/client-core/src/features/fleet/NodeGate.tsx` handles starting, unpaired, and failed Node
states. It has no content for a ready Node whose plugin or restoration gate still holds.

`apps/desktop/src/client/pluginStartup.ts` caches the roster promise and marks ready after
registration. A rejected import or registration retains the rejection with no dedicated retry state.
`apps/desktop/src/client/index.tsx` schedules the roster after a frame, with a 250 ms hidden-window
fallback. `apps/desktop/src/client/activate.ts` owns core registration and the plugin-ready signal.

`packages/client-core/src/infra/persistence/appStartup.ts` waits for data and contributions before
hydrating layouts. `packages/client-core/src/host/registries/panes/panes.ts` uses blank Suspense
fallbacks. `packages/client-core/src/kit/components/content/ContributionBoundary.tsx` supplies view
error recovery. Preserve its reporting rather than adding another error pipeline.

## State and message contract

Give one startup coordinator ownership of progress and failure. Derive it from lifecycle signals;
do not duplicate Node connection state or mutate plugin state from a loading component.

| State | Suggested visible message | Exit condition |
| --- | --- | --- |
| Selecting a Node | Connecting to your computer... | Fleet selection settles. |
| Starting the supervised local Node | Starting Acorn's services... | Its first broker status arrives. |
| Registering required contributions | Preparing your workspace... | Required registration succeeds. |
| Restoring state and destination | Restoring your workspace... | Hydration and destination selection settle. |
| Opening restored content | Opening your last view... | The selected destination reports a usable state. |
| Failed | Acorn couldn't finish loading | An action retries the failed operation or opens diagnostics. |

Stages overlap in real execution. Derive a deterministic message for the dependency holding progress;
do not force operations into a serial pipeline for presentation. A known offline remote Node releases
into cached content or an actionable offline state. It must not say that Acorn is starting its process.

Use the established Acorn loading component and appearance tokens. Reserve stable geometry, expose
status to assistive technology, and avoid fake percentages or enforced splash delays. Keep messages
about the person's workspace; plugin module names and stacks belong in expandable diagnostics.

## Implementation

1. Add a typed startup projection with explicit pending, ready, and failed outcomes beside the
   desktop startup owner. Feed it Node state, registration, cache restoration, preference settlement,
   hydration, destination selection, and phase 01's content completion. Keep App as composition.
2. Render each pending stage in a single stable loading screen. Retain Node-specific recovery and
   add registration/restoration recovery without treating every failure as a connection failure.
   A ready Node with pending client work must have a visible message.
3. Make roster import retry discard its failed promise and prevent stale attempts from completing
   after replacement. Reuse plugin-host disposal/registration ownership for partial registration;
   do not activate duplicate commands, schedules, listeners, or state slices on retry.
4. Preserve hydration-before-persistence and hydration-before-pane-defaults. Resolve failed initial
   reads into explicit retry or cached/offline recovery; do not wait forever for undefined lists.
   Expose usable shell navigation once its identity and state are ready. Keep the restored content
   region in its own pending state instead of extending the whole-app loader for every lazy pane.
5. Replace blank pane/layout loading fallbacks with host-owned, labelled placeholders. Keep separate
   boundaries per region so one pending region cannot blank its neighbour. Apply equivalent loading
   presentation to source browsing and settings where their lazy components need it.
6. Preserve drawn content during revalidation and later disconnects. The Solid Suspense patch already
   protects resolved content; do not remove that behaviour. Use the established contribution error
   boundary, and give failed imports a real loader retry rather than only resetting a cached error.
7. Emit phase 01's milestones and bounded failed-stage attributes from this coordinator. Keep
   first-frame, restoration, shell readiness, and usable content distinct in local and Sentry reports.

The terminal host reuses state semantics and shared region placeholders where applicable. It does
not acquire desktop-specific startup UI. Keep placement, key focus, and draft state across retries.

## Verification and completion

Use deferred operations to test Node-ready/plugin-pending, cache-pending, registration failure and
retry, partial registration cleanup, failed initial reads, Node switching, and restoration ordering.
Test a ready region beside a pending region and retained content during refetch. Assert observable
messages and registry/persistence outcomes rather than private state-machine fields.

Run `pnpm lint`, `pnpm test --filter=@acorn/client-core`, `pnpm test --filter=@acorn/tui`,
`pnpm --filter @acorn/desktop test`, and `pnpm --filter @acorn/arch-tests test`.

Run `pnpm dev:agent -- --session performance-startup` and use its UI driver to record a fresh launch,
established launch with saved layouts, slow loading, failure/retry, offline remote selection, and
first-run onboarding. Inspect screenshots of transitions and use `stop` when done. Repeat shared
placeholder behaviour with `pnpm dev:tui:agent -- --session performance-startup --fixture tui-navigation`.

Completion requires no blank whole-app state from a ready Node, changing stage messages, usable
recovery, retained drafts/layouts, and milestone records matching the visible transitions. Update
[startup readiness](../../frontend/data-and-startup.md), [states](../../ui-design/states.md), and
[profiling](../../local-development/profiling.md).

## Recheck before implementation

If retry requires another lifecycle owner or restore writes defaults over saved values, resolve that
contract before changing presentation. Do not bypass readiness to make a screenshot appear sooner.
