# Phase 2: make the panel views portable

Date: October 21, 2026. Status: proposed. Needs nothing. Can be built beside phase 1.

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
