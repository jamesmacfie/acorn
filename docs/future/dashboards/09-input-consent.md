# Phase 9: approving what a plugin reads

Status: shipped, October 5, 2026. [What shipped](#what-shipped) records the choices made while
building it. Depends on [phase 8](./08-source-inputs.md). Read the
[programme README](./README.md) first. The
[Derived Sources](https://claude.ai/artifact/W8vHKDojobsSD4GYi5xPxK) page shows the dialog and the
plugin page in "Installing: saying what it reads, before it runs".

## Goal

Before a loaded plugin reads any of your data, Acorn tells you which sources it reads and that it
reads them only with accounts you choose. You approve that once per input list. An update that
reads something new asks again and leads with the new line. The plugin's settings page shows what
data it provides and what it reads, and which panels use each input.

## Starting point

- The trust prompt is `packages/client-core/src/host/trust/PluginTrustDialog.tsx`, with its lines
  from `trustModel.ts` and `permissions.ts` in the same folder. It's keyed by plugin id and client
  bundle hash. A plugin with no client half gets no prompt, and a node install or update discloses
  nothing on the device. The prompt has three groups that are never merged: **Enforced** ("acorn
  blocks anything not listed."), **Declared**, and **Web pages**. On an update it leads with "New
  in this version" and folds the rest under "Everything *v* already had — unchanged".
- Agent-staged packages get a node-side review, `PluginApprovalDialog.tsx` in the same folder, backed
  by `packages/node-core/src/server/plugins/pendingReview.ts`. Its marker file keeps a downloaded
  package inert until someone approves it. That's the closest model for a node-side decision.
- The Installed list is `packages/client-core/src/features/settings/plugins/PluginsSettings.tsx`,
  with a **Needs you** filter and status words from
  `packages/client-core/src/host/plugins/pluginStatus.ts`.
- The plugin page is `packages/client-core/src/features/settings/plugins/PluginPage.tsx`, with
  **Overview**, **Permissions**, and **Versions** tabs. **What it adds** lists rail sources, settings
  pages, replaced surfaces, commands, agent tools, and events. It lists no data sources.
- Phase 8 stores input grants on the Node in `inputGrants.ts` and refuses ungranted inputs.

## Requirements

### The Node side

1. Add a route to read and change input grants, under the existing plugin routes:
   `GET /v1/core/plugins/:id/input-grant` returns the declared inputs, the current grant, and the
   difference. `POST` with the exact input list the person saw writes a grant for that list. The
   Node refuses a `POST` whose list doesn't match what the installed version declares, so a stale
   dialog can't approve something it didn't show.
2. Add `inputs-awaiting-approval` to the plugin roster entry when the declared inputs differ from the
   grant, with the new and changed input names. The roster already carries `state` and `reason`
   for load failures. Use the same channel.
3. Revoking a grant is a `DELETE` on the same route. Reads stop on the next request.

### The dialog

4. Add a **Reads your data** group to the trust model, before **Enforced**, with the help text
   "Acorn blocks anything not listed." One line per input:
   - Required: "Read **pull requests** from GitHub", with the detail "With the GitHub account you
     choose for each panel. It can't comment, merge, or change anything."
   - Optional: "Read **issues** from Linear, if you choose an account", with the detail "Optional.
     Panels work without it."
   Build each line from the input's label, the input source's plural and provider name, and its
   optional flag. Never from text the plugin wrote about itself.
5. Add a **Provides** group listing each data source the plugin registers: "A data source,
   **Release readiness**", with the detail "You can use it in panels, workflows, and datasets."
6. Show this dialog for a plugin with inputs even when it has no client half. Drive it from the
   roster's `inputs-awaiting-approval` state, not from the client bundle hash. A plugin with both a
   client half and inputs shows one dialog with every group, and accepting it records both
   decisions.
7. On an update whose inputs changed, lead with "New in this version" containing only the new or
   changed input lines, as the trust prompt does for other grants. Unchanged inputs fold under
   "Everything *v* already had — unchanged".
8. **Accept** posts the grant. **Reject** turns the plugin off, as rejecting a plugin does today.
   **Not now** records nothing. Until a decision, the plugin's other features work, and its derived
   sources keep reading only the inputs the old grant covers.
9. `PluginApprovalDialog.tsx`, for agent-staged packages, shows the same **Reads your data** and
   **Provides** lines, so a plugin an agent writes can't skip them.

### The Installed list and the plugin page

10. A plugin waiting for an input approval shows under **Needs you**, with the status "Waiting for
    you to approve what it reads." Its row's **Manage** opens the dialog.
11. On the **Overview** tab, **What it adds** gains a **Data sources** row listing each source by
    name.
12. On the **Permissions** tab, add a **Reads** section. One row per input: its label, the source and
    provider, and the panels that use it, such as "Pull requests · GitHub · used by 2 panels with
    the Work account". Count panels from the published plans' input bindings. Add **Revoke** beside
    the approval, which calls requirement 3's `DELETE` after a confirm.
13. A plugin whose grant is revoked keeps its panels. They show the unavailable state from phase 10
    until the grant comes back.

## Out of scope

- Per-panel approval. One grant covers the plugin's input list. Accounts are still chosen per panel,
  so the grant never covers an account.
- Approving inputs from the terminal client. It draws no dashboards. A plugin awaiting approval shows
  its status line there and points to the desktop app.

## Tests

- Node route tests: read, write with a matching list, refuse a mismatched list, revoke, and the
  roster state after an update that adds an input.
- `trustModel.test.ts` and `permissionLines.test.ts`: the **Reads your data** and **Provides** lines,
  optional wording, and the update diff that leads with only the new input.
- A `PluginTrustDialog.test.tsx` under the client-core `hosts` tier: a node-only plugin with inputs
  shows the dialog; **Accept** posts the exact list shown.
- `PluginPage` tests: the **Data sources** row and the **Reads** section with a panel count.

## Check it in the app

Install a test plugin with two inputs from a local folder in a `dev:agent` session. Check that the
dialog appears with both lines before any panel can read through it. Accept, then change the
manifest to add a third input, reload the plugin, and check that only the new line leads the
dialog.

## Docs to update

- `docs/plugins/distribution.md` § Trust on the device: input approval is node-side and keyed by
  the input list, not the bundle hash.
- `docs/plugin-authoring/permissions.md`: what the person sees for each input, and that wording comes
  from the input source, not the plugin.
- `docs/api-reference/core-routes.md`: the input grant routes.
- `docs/security/plugin-node-realm.md`: the grant and when it's checked.

## Verify before building

- How `PluginTrustDialog` is queued today (`syncPluginDistribution`), so the input approval queues
  through the same path rather than a second dialog host.
- Where the roster entry type lives and whether `state` can carry a non-failure reason, or needs a
  separate field.
- That counting panels per input is cheap. If it isn't, show the count only on the **Permissions**
  tab and compute it when the tab opens.

## What shipped

Requirements 1 to 12 shipped. Requirement 13 holds: revoking keeps every panel, and their reads fail
with `input-unavailable` until phase 10 draws the unavailable state.
[Derived sources](../../data-sources/derived-sources.md#approve-inputs-for-loaded-plugins) and
[plugin distribution](../../plugins/distribution.md#approving-what-a-plugin-reads) describe the
shipped behaviour and win over this page.

Where the code lives:

- `NodePluginRow.inputs` in `packages/protocol/src/transport/api/pluginState.ts` carries each declared
  input and whether the grant covers it. `pluginInputs` in
  `packages/node-core/src/server/plugins/inputGrants.ts` builds it, and `pluginState` fills in the
  words. The bridge gained `inputGrants()`, built from the data root in
  `apps/node/src/composition/pluginState.ts`.
- The routes are in `packages/node-core/src/server/routes/plugins/plugins.ts`. The panel count is
  `pluginInputUsage` in `packages/node-core/src/server/dashboards/inputUsage.ts`.
- `derivePluginDistribution` in `packages/client-core/src/host/plugins/distributionModel.ts` queues
  input requests. `trustModel.ts` adds the two groups and `recordInputDecision`, and `permissions.ts`
  words the lines.

Choices made while building it:

- The roster carries a separate `inputs` field, not an `inputs-awaiting-approval` state. `state` says
  whether the code runs and drives the restart banner, and a plugin waiting for this approval still
  runs. "Awaiting" is any input with `approved: false` on a row that isn't off or held for review.
- The Node words each line, not the client. It reads the input source's `plural` from the registry,
  and names the provider by the label of the plugin that owns the input source. A loaded owner's id
  stands in for its label, because a loaded plugin writes its own label. A source with no
  `providerId` gets no "from" clause, and an unregistered source shows its `<pluginId>:<sourceId>`.
- An input-only request has an empty `hash`. It merges into a bundle request for the same plugin and
  Node, so a plugin with both asks once. The dialog answers inputs first, because that answer
  re-reads the roster, and then records the bundle answer.
- **Reject** turns the plugin off on its Node through the disabled list. That takes effect at the next
  restart, as every disable does.
- The required detail reads "It can only read, so it can't change anything." rather than "It can't
  comment, merge, or change anything.", which only fits GitHub.
- The agent review dialog's **Turn on** also posts the grant for the list its review screen showed,
  so an agent-written plugin doesn't ask twice.
- Counting panels scans every published plan, so the plugin page reads it only while **Permissions**
  is open. Account names come from the active Node's integrations, and an unknown account is left out
  of the sentence.
- The terminal client reads the queue through `pendingBundleTrust`, which leaves out input-only
  requests. Its prompt says when a plugin also reads your data, and points to the desktop app.
- The in-app check above wasn't run. Node route tests, model tests, and jsdom tests for the dialog
  and plugin page cover the requirements.
