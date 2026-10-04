# Phase 9: approving what a plugin reads

Status: proposed, October 5, 2026. Depends on [phase 8](./08-source-inputs.md). Read the
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
