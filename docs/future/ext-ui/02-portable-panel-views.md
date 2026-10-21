# Phase 2: make the panel views portable

Date: October 21, 2026. Status: done. Needs nothing. Can be built beside phase 1.

## Completion note

Landed on October 21, 2026, on the `phase-2-portable-panel-views` branch.

What landed:

- `views/host.ts` holds the `PanelViewHost` type and its context, `PanelViewHostContext`. Both
  members, `openLink` and `measureHistory`, are optional. `Cell` and `StatView` read them, and no
  longer import the router, the tasks feature, or the history module.
- `DesktopPanelViewHost` provides today's behavior: `openInAppUrl` with the router's `navigate` and
  the active task, and `createMeasureHistory`. The desktop's `apps/desktop/src/client/index.tsx`
  mounts it once, as the router's root, around `App`.
- `RunPanel.tsx` draws one run from props: the supplied-rows line, "Couldn't refresh", the client's
  problems, the as-of line, the coverage and partial notes, the client's notices, the description,
  and `PanelBody`, with the loading and failed states. It works out the groups, `groupBy`,
  provenance, buttons, the press flag, and the board's choices from the run. It imports the kit,
  dashboards-core, protocol types, `SuppliedOrigin`, `shaping`, and the views, and nothing from
  `host/`, `infra/`, the router, or TanStack Query.
- `PublishedDashboardPanel` draws its body through `RunPanel`. Its queries, the kept-dataset line,
  drill-downs, board writes, row actions, and confirms stay where they were.
- client-core exports `RunPanel.tsx`, `views/host.ts`, and `DesktopPanelViewHost.tsx`. The count in
  `tools/arch/boundaries.test.ts` went from 204 to 207.
- Tests: `views/host.test.tsx` draws a link cell and a history stat with and without the context.
  `DesktopPanelViewHost.test.tsx` pins the desktop's wiring. `RunPanel.test.tsx` draws a fixture run
  as each of the six views with no providers, and the loading, failed, and stale states.
  `apps/extension/src/sidebar/panelViews.test.tsx` draws a run with a link column and a history
  stat.
- Docs: "Drawing a run in any client" in [views](../../dashboards/views.md).

Decisions and deviations:

- The context follows client-core's naming, as `UnsavedChangesContext` does: the type is
  `PanelViewHost` and the context is `PanelViewHostContext`.
- `openLink` takes the URL only, not `(url, field)`. No client needs the field.
- Both members are optional, so phase 3 can provide `openLink` alone. Without `measureHistory`, a
  history stat also leaves out "Recording once an hour from today.", because nothing records for
  that client.
- A link cell is a link only for `https`, because `formatCell` already turns anything else into
  text. The fallback needed no new check.
- The desktop mounts the provider in `index.tsx`, as the router's root, and not inside `App.tsx`.
  It's the same tree, and it's one line.
- Source failures. `RunPanel` takes a `problems` slot holding the latest answer's problems, drawn by
  the client, and not text for each failure. The desktop passes its list, with `SourceFailureAlert`
  for failures and plain warnings for the rest. The shown run and the latest answer differ while a
  stale run is on screen, and the problems must come from the latest one.
- `RunPanel` takes the answer to draw, `stale`, and `error`, and the client picks the answer. The
  desktop's rule, which keeps the last good answer while a source can't answer, stays in
  `PublishedDashboardPanel`, because its handlers act on the shown run.
- A board move's optimistic value goes onto the run's rows before `RunPanel`, not onto the display
  rows. `displayPlanRun` copies a value through unchanged, so the result on screen is the same.
- The import list. `views/PanelBody.tsx` and `dashboards.css` weren't exported. The sidebar reaches
  `PanelBody` through `RunPanel`, and `RunPanel` imports `dashboards.css` itself, as `CardFrame`
  does. `CardFrame.tsx` was already exported. `DesktopPanelViewHost.tsx` was exported instead, for
  the desktop.
- The kept-dataset line stays in `PublishedDashboardPanel`, before `RunPanel`. A plan's first source
  is supplied or kept, never both, so the order on screen is unchanged.
- The failed state still says "Edit the panel to repair its source or column." The sidebar can't
  edit, so phase 3 may want other words there.

Checks:

- Every dashboards test passed unchanged: 31 files and 197 tests, before the new ones.
- The extension test fails with the old `Cell.tsx`, which can't load the router's JSX build, and
  passes with the new one.
- The sidebar build is byte for byte the same: `sidebar-C-4Lo6jJ.js` at 263.37 kB (82.46 kB
  gzipped), and `sidebar-CDc4f5Yh.css` at 108.10 kB, with the same content hashes before and after.
- The Node service measured 1,915,111 B, under the 1,917,500 B ceiling, the same as after phase 1.
- In `pnpm dev:agent`, a Tasks panel set to a stat with **Saved history**, placed on Home, draws
  "0 items" and "Recording once an hour from today." That note draws only when a history reader is
  provided, so the desktop provider is mounted on a placed panel. No account-free source in that
  session has an `https` link field, and the studio's JSON tab is read only, so a link cell wasn't
  clicked in the real app. `DesktopPanelViewHost.test.tsx` covers the link, and the same provider
  supplies both members.
- client-core (2,910 tests), the extension (264), trellis (49), and agents (209 files) pass. The
  first agents run failed "bounds the complete catalogue read" while the machine was under load,
  and passed on the rerun.
- The public site's dashboards page cites `views.md`. The new section describes code, not what a
  person sees, so the page needs no change.

For later phases:

- Import `@acorn/client-core/features/dashboards/RunPanel.tsx` and draw it inside `CardFrame`. To
  open links through the `tabs` API, provide `PanelViewHostContext` from
  `@acorn/client-core/features/dashboards/views/host.ts` with `openLink`.
- Pass `describe` for an agent's panel, so the run's description shows. A press handler left out is
  off. Without `onButton` and `onCorrect`, a table draws no row controls. Without `onDrilldown`,
  group headers aren't pressable.
- `describeSourceFailure` in `sourceErrors.ts` imports `ApiError` from `infra/`, so the sidebar
  can't describe a failure with it as it stands. The host can send the text, or the import can be
  split out.

## Goal

A client without the desktop's router, query client, or Node connection can draw a dashboard run with
the dashboard's own views. Nothing changes for the person. This phase only moves seams, so phase 3
can mount the views in the sidebar.

## Starting point

- The six views are in `packages/client-core/src/features/dashboards/views/`, behind `PanelBody`.
  Each takes `PanelViewProps`: the rows, fields, and schema already shaped, and optional handlers
  for presses, buttons, drill-downs, and board moves. Most of them draw only what they're handed.
- Two views reach outside their props, on every mount:
  - `Cell.tsx` calls `useNavigate()` from `@solidjs/router`, and uses `openInAppUrl` from
    `host/registries/panes/contentLinks` and `activeTaskId` from the tasks feature, to open a link
    cell inside Acorn.
  - `StatView.tsx` calls `createMeasureHistory`, in `history.ts`, which calls TanStack Query's
    `createQuery` and reads `/v1/core/dashboards/history` with `readJson`. The query is only enabled
    for `trend: 'history'`, but `createQuery` throws without a `QueryClientProvider` either way.
- `PublishedDashboardPanel.tsx` is 939 lines. It reads the published revision or runs a draft plan,
  turns the run into display rows with `displayPlanRun` from `@acorn/dashboards-core/plan.ts`, and
  draws the description, the supplied-rows line (`SuppliedOrigin`), source failures
  (`SourceFailureAlert`), drill-downs, board writes, and row actions around `PanelBody`.
  `PlanPanel.tsx` and the desktop's `PanelToolCard` both draw through it.
- `SourceFailureAlert.tsx` links to the desktop's settings pages, and `KeptOrigin.tsx` reads datasets
  and shows toasts. `SuppliedOrigin.tsx` uses only the kit.
- `CardFrame.tsx` uses only the kit and `dashboards.css`.
- The extension's sidebar imports the kit from `@acorn/client-core` by file path and loads the
  desktop's token and style sheets in `apps/extension/src/sidebar/main.tsx`. `tools/arch/boundaries.test.ts`
  counts client-core's importers.

## Requirements

### The views

1. A view's ties to the shell move behind one context, `PanelViewHost`, in
   `views/host.ts`. It has two members:
   - `openLink(url, field)`, which `Cell` calls for a link cell. Absent, a link cell is a plain
     `<a target="_blank" rel="noopener noreferrer">` for `http` and `https` addresses and text for
     anything else.
   - `measureHistory(panelId, enabled)`, which `StatView` calls for a history trend. Absent, a stat
     with `trend: 'history'` draws without a trend line.
2. The desktop provides `PanelViewHost` once, where it mounts the client, with today's behaviour:
   `openInAppUrl` with the router's `navigate` and the active task, and `createMeasureHistory`.
   `Cell` and `StatView` stop importing the router, the tasks feature, and the history module.
3. Nothing else in `views/` changes. A view test that draws a link cell or a history stat passes with
   and without the context.

### The run-to-panel step

4. A component, `RunPanel`, draws one finished run: the description lines, the supplied-rows line,
   `PanelBody` with `displayPlanRun`'s rows, fields, and schema, and the empty and failed states. It
   takes the run, the plan, and the view handlers as props, and imports nothing from `host/`,
   `infra/`, the router, or TanStack Query.
5. `PublishedDashboardPanel` draws its body through `RunPanel`, so the desktop and the sidebar draw a
   run with the same component. Its querying, drill-downs, board writes, and actions stay where they
   are.
6. Source failures pass to `RunPanel` as already-described text. The desktop keeps
   `SourceFailureAlert` and its settings links, and passes them in as a slot. The sidebar passes plain
   text.

### The import list

7. `tools/arch/boundaries.test.ts` gains the new client-core files the extension may import:
   `views/PanelBody.tsx`, `views/host.ts`, `RunPanel.tsx`, `CardFrame.tsx`, and `dashboards.css`. Its
   count for `@acorn/client-core` rises to match, with a reason.
8. A test in `apps/extension` imports `RunPanel` with a fixture run and draws it without a router or a
   query client. This is what stops the seam from closing again.

## Out of scope

- Drawing anything new in the sidebar. That's phase 3.
- Splitting `PublishedDashboardPanel` further. Only its body moves.

## Risks

- **A regression in the desktop's panels.** Every panel, card, and app `Panel` draws through the
  changed code. The existing tests for `PublishedDashboardPanel`, `PanelToolCard`, and the views must
  pass unchanged, and a placed panel with a link column and a history stat needs checking by hand in
  `pnpm dev:agent`.
- **The context's default hides a missing provider.** A desktop window that forgot the provider would
  draw links as plain links and drop history trends, with no error. The desktop's provider test pins
  it.

## Steps and checkpoints

**Checkpoint 1.** `PanelViewHost` in place, the desktop providing it, and every dashboard test green.

**Checkpoint 2.** `RunPanel` drawing a fixture run of each of the six views in a client-core test with
no providers at all.

**Checkpoint 3.** The extension test from requirement 8 green, and `pnpm --filter @acorn/extension
build` still producing a sidebar that loads. Record the sidebar's built size. It shouldn't change,
because nothing imports the new files yet.

## Docs that change

- [Dashboards views](../../dashboards/views.md): the view host context and `RunPanel`.
- [Frontend](../../frontend.md), if it lists what other apps may import from client-core.

## Verify before building

- Whether any other view, or `RowControls`, reaches the shell. At `a6842f9b7` only `Cell` and
  `StatView` do.
- Whether `PublishedDashboardPanel` changed shape since `a6842f9b7`. It's the busiest file in the
  dashboards feature.
