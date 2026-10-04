# Phase 10: choosing inputs in the launcher and the studio

Status: proposed, October 5, 2026. Depends on [phase 8](./08-source-inputs.md), and on phases
[3](./03-studio-shell.md), [4](./04-inspectors.md), and [5](./05-launcher.md) for the surfaces it
extends. Read the [programme README](./README.md) first. The
[Derived Sources](https://claude.ai/artifact/W8vHKDojobsSD4GYi5xPxK) page shows the launcher, the
studio, the missing-account state, and the failure table in "Using it in a panel" and "When things
change or fail".

## Goal

Using a derived source in a panel feels like using any other source. The person picks one account
per input where they would pick an account for a plain source. The outline shows the inputs under
the source with their row counts. When an account is missing or something fails, the panel names
the input or the plugin and offers the fix. It never shows a code or a JSON pointer. The AI author
can propose a derived source and asks which accounts to use.

## Starting point

- After phase 8, `describe` on a derived source returns its fields with no bindings, and a query
  needs a binding per required input in `scope.inputs`. Errors `input-required` and
  `input-unavailable` carry the input's name.
- After phase 5, the launcher (`PanelLauncher.tsx` in the studio folder) lists source and account
  pairs and expands a picked row to show starter plans.
- After phase 3, the outline comes from `planOutline` (phase 2). After phase 4, the source inspector
  shows **Source**, **Account**, **Reach**, required parameters, and **How it joins**.
- Run problems are `"${source.label}: ${error.message}"` in
  `packages/node-core/src/server/dashboards/run.ts`, so a panel shows "Pull requests:
  connection-required". `PublishedDashboardPanel.tsx` draws them as one warning with the pointer in
  front. `SourceQueryEditor.tsx` maps four error codes to sentences and links nowhere.
- Compiled plugins open Settings with
  `clientEvents.emit('presentation:open-settings', { tab: 'integrations' })`. Settings has
  `openConnectionPage` in `packages/client-core/src/features/settings/connections/connections.ts`.
  A loaded plugin has no way to open Settings. The bridge's UI verbs are a closed list in
  `packages/protocol/src/plugin/bridge.ts`.
- The authoring route's `list-accounts` metadata call returns the person's accounts. The model sees
  each source's description, not its inputs.

## Requirements

### The launcher

1. A derived source's row reads "*Name* · *Plugin* · reads *Provider* and *Provider*", built from
   its inputs' providers. Show the plugin's brand mark, as rows show provider marks.
2. Picking the row expands it with one account `Select` per input, labelled with the input's label,
   with "optional" after optional inputs. Preselect the person's only account for a provider when
   there is exactly one, as the launcher does for plain sources. An optional input offers **Skip**.
3. Starter plans and **Blank** sit under the input pickers. They stay disabled until every required
   input has an account. Picking one returns `{ kind: 'source', reference, starter? }` with the
   bindings in the reference's `scope.inputs`.
4. In a plugin region, the region's source rules apply to the derived source's own id, not to its
   inputs.

### The outline

5. Extend `planOutline` (phase 2) so a source with inputs gets one child part per input, keyed
   `input:<sourceId>:<name>`, in section `data`. Each shows the input label, provider, account, and
   reach. `partForPath` maps `/sources/<n>/reference/content/query/scope/inputs/<name>` to it.
6. The trailing count on an input row is the input's row count for the last run. Add per-input
   counts to `diagnostics.sources` in the run. The derived source's own row keeps its output count.
7. An input with a problem, such as a missing account, marks its own row, not the source's.

### The inspector

8. The source inspector for a derived source shows "From *Plugin*. Reads the inputs below with the
   accounts you choose here." Then, per input, a group with the account `Select`, **Reach** when the
   input source declares one, and the input source's required parameters. These are the same
   controls a plain source of that kind shows, fed from the input source's description.
9. The derived source's own parameters follow under "Its own settings", drawn by the standard
   parameter controls. The plugin never draws UI here.
10. **About this source** opens the plugin's page in Settings.

### Missing accounts

11. An input with no account for its provider shows "No *Provider* account is connected." with
    **Connect *Provider*…** and, for an optional input, **Skip this input**. The studio draws the
    button and opens Settings with `presentation:open-settings` and the integrations tab, through the
    same path compiled plugins use.
12. When the person returns with a new account, the input's `Select` lists it without a reload.
    Invalidate the connections query on focus, as the panel does for runs.
13. **Publish…** is blocked while a required input has no account, with the reason "*Input* needs a
    *Provider* account."

### Plain failure messages

14. Map data source errors to sentences once, in a module named `sourceErrors.ts` in the dashboards
    feature folder, and use it in the studio, the placed panel, and `SourceQueryEditor`. Each entry
    has a message and an optional fix the host can draw:

    | Code | Message | Fix |
    | --- | --- | --- |
    | `connection-required` | "*Source* needs a *Provider* account." | **Choose an account** |
    | `input-required` | "*Input* needs a *Provider* account." | **Choose an account** |
    | `input-unavailable` (not approved) | "*Plugin* is waiting for you to approve what it reads." | **Review** |
    | `input-unavailable` (disconnected) | "*Input* can't be read. The *Account* account is disconnected." | **Reconnect…** |
    | `unavailable` (plugin off) | "*Source* comes from *Plugin*, which is off." | **Turn it on** |
    | `forbidden` | "This account isn't available in this workspace." | **Choose an account** |
    | `rate-limited` | "*Provider* asked us to slow down. Trying again shortly." | none |
    | `timeout` | "*Source* took longer than the panel allows." | none |
    | other | "*Source* couldn't answer." | **Try again** |

15. Make the run carry the code, the source id, and the input name with each problem, instead of a
    preformatted string, so the client can build the sentence and the fix. Keep `message` for older
    clients.
16. Show `incomplete` with cause `invalid-records` as "*Source* returned *N* records that didn't match
    what it declared." Show an incomplete input as "*Provider* returned only part of the *plural*, so
    some items may be missing."
17. A placed panel whose derived source is unavailable keeps its last data greyed out, with the
    message and fix above, rather than "Couldn't load this panel".

### About this panel

18. **About this panel** (phase 7) shows the chain under the source: "Release readiness (Northwind),
    reading Pull requests (GitHub · Work) and Cycle issues (Linear · Acme)".

### The AI author

19. Send each derived source's inputs with its description in the authoring context: the input
    names, labels, sources, and whether they're optional.
20. The model chooses accounts for inputs under the same rule as for plain sources: only an account
    the person chose, or the only usable one. When more than one fits, it asks with a clarification
    whose choices are the person's accounts for that provider.
21. The validator applies the account rule to every input binding, and checks that each required
    input has one.

## Out of scope

- Changing the plugin bridge so loaded plugins can open Settings. The host draws every fix button.
- Editing a derived source's logic from the studio. That lives in the plugin.

## Tests

- `outline.test.ts`: input child parts, their keys, and `partForPath` for an input pointer.
- `sourceErrors.test.ts`: every code in the table, with and without an input name.
- `PanelLauncher.test.tsx`: input pickers, preselection with one account, **Skip**, and disabled
  starters until required inputs are bound.
- `PanelStudio.test.tsx`: the missing-account state, the **Publish…** block, and an input row marked
  for its own problem.
- The authoring evaluation suite in `packages/dashboards-core/src/authoringEvaluation.test.ts`:
  a request that a derived source answers, with two GitHub accounts, asks which one.

## Check it in the app

With a test derived source from phase 8 installed and approved, build a panel from the launcher.
Disconnect the GitHub account in Settings and check the panel names the input and offers
**Reconnect…**. Turn the plugin off and check the panel keeps its last data greyed out.

## Docs to update

- `docs/dashboards/mapping-and-editor.md` § The generated editor: inputs in the launcher and studio.
- `docs/dashboards.md` § Published panels: the plain failure messages and the greyed-out state.
- `docs/api-reference/core-routes.md`: the run's structured problems.

## Verify before building

- Every place that renders a run problem, so `sourceErrors.ts` replaces them all.
- That `presentation:open-settings` can open a specific connection page, not only the integrations
  tab. If not, open the tab.
- Whether per-input counts fit in `diagnostics.sources` without breaking the run's response size
  limit for panels with many sources.
