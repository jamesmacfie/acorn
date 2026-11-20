> **Completion note, November 20, 2026.** Fixed on the Acorn side, on branch
> `phase-l-4-loaded-plugins-lose-privileged-capabilities`.
>
> What landed:
>
> - `LOADED_PLUGIN_CAPABILITY_IDS` in `packages/protocol/src/plugin/ids.ts` is the explicit list of
>   built-in capabilities a loaded plugin may resolve. `scopeCapabilities` resolves a declared id only
>   when it's on that list or another loaded plugin provided it. `CapabilityRegistry.provide` records
>   which ids a loaded plugin provided, and `dispose` clears the record. Every other built-in id reads
>   as absent through `get` and `ids`, and `require` throws. That covers `terminal.sessions`,
>   `terminal.sendToAgent`, `terminal.runTargets`, `account.service`, `agents.harnessRegistry`,
>   `agents.requestAnswer`, `database.query`, and the internal reconcile hooks.
> - The trust prompt has a sentence for every published id. Its table is typed as a record over the
>   list, so publishing an id without a sentence fails the build. Reads of message text, memories,
>   and the GitHub mirror are marked high. An id off the list reads "Use capability X from another
>   installed plugin", because only another loaded plugin can supply one.
> - `account.service` has no generic `fetch`. It offers `slackGateway({ method, path, body, signal })`,
>   `nodes()`, and `url(path)`. `slackGateway` checks the path before it borrows the token: it must
>   resolve on the configured account origin, parse back to the same path, and match one of the Slack
>   gateway's Node routes. The request goes out with `redirect: 'error'`. The Slack plugin uses these
>   methods.
> - `apps/node/test/integration/pluginSystem/loadedCapabilities.test.ts` boots the real account plugin,
>   a built-in stand-in under the real terminal ids, and two loaded plugins through `initPlugins`. A
>   loaded plugin that declares all four private ids resolves none of them, and no stand-in or network
>   call runs. A published id and another loaded plugin's id still resolve. The test fails with the
>   check removed. `plugins/account/src/server/service.test.ts` uses a fake `fetch` to show that seven
>   refused destinations borrow no token and send nothing. These include another origin, `//host`,
>   relay tickets, a `..` path, and a query string.
>
> Decisions and deviations:
>
> - The public list is the old catalogue less what starts processes, carries a credential, writes
>   into another plugin's state, or is a host-internal hook. The reads behind the event table in
>   `docs/plugins/events.md` stay public, as do `agents.draftAttachments` and the two caller-bound
>   agent capabilities. `notes.store` is private because it writes notes that agents read.
> - I didn't raise `PLUGIN_API_MAJOR`. Doing so would stop every installed plugin from loading. The ten
>   private ids stay in `CapabilityCatalogue`, marked `@deprecated` as private, so the published
>   surface snapshot is unchanged. Most were `HostOwned`, so their shape was never promised. A loaded
>   plugin that used one gets `undefined` from `get`, or an init failure on its roster row from
>   `require`. `contract.test.ts` holds the catalogue, less the named private ids, to the host's list.
> - Only `agents.sessionExecute` and `agents.sessionControl` act for the owner, and both were already
>   caller-bound. I didn't bind the read capabilities or `agents.draftAttachments`, whose change shows
>   in the composer before the person sends.
> - A loaded plugin can still fill `agents.harnessRegistry`, and another loaded plugin that declares it
>   then resolves it. That was outside this finding.
>
> For later phases: `apps/relay/src/slackGateway.test.ts` fails two cases, the mention and the
> non-owner `/acorn` note, on this branch and on its base `f1527a029`. The test never confirms the
> Slack link, which X-1 made mandatory. Nothing here caused it.
>
> What acorn-cloud would still need: nothing. The gateway routes and the nodes list are unchanged.

# L-4. Loaded plugins can use privileged host capabilities

Found November 20, 2026, in Acorn at `90b9e61e3`. Severity is high. The missing capability
and credential-destination checks are confirmed from source. Status is open.

## Evidence and impact

The loaded-plugin host grants capabilities by declaration. A capability provider can restrict
the caller, but the host also returns providers that supply no such restriction. The consent
screen describes an unrecognized capability by name and does not disclose its underlying
process or account authority. The review traced two effects.

- `packages/node-core/src/server/plugins/permissions.ts` scopes capability access to manifest
  declarations and applies a caller binding when the provider supplies one.
- `plugins/terminal/src/node/index.ts` exposes the terminal capability used for agent handoff.
  Its contract in `plugins/terminal/src/contract/sessions.ts` can launch a process in a task.
  This path uses the host terminal engine without the worker's process permission.
- `plugins/account/src/contract/service.ts` reserves the account capability for compiled plugins.
  The registered provider in `plugins/account/src/node/index.ts` supplies no caller restriction.
  `plugins/account/src/server/service.ts` attaches the signed-in owner's bearer credential
  without validating the destination, outside the worker's network restrictions.
- `packages/client-core/src/host/trust/permissions.ts` describes unrecognized capabilities with a
  generic line that does not disclose the account access.

A hostile or compromised plugin must be installed with the capability declaration. The terminal
path can run code as the Node owner if the plugin can resolve a task. The account path requires
a signed-in owner and can expose a bearer that authorizes account operations beyond Slack.
The resulting account access can reach the boundary described in
[X-1](./x-1-account-takeover-to-slack-agent-turns.md).

## Fix and verification

Publish an explicit set of capabilities available to loaded plugins. Keep terminal internals
and the account service private to compiled code. Bind every privileged public capability to
the calling plugin and disclose the authority that the host grants. Give compiled account
consumers an operation-specific interface. Validate the destination against the configured
account origin before borrowing a credential and prevent redirects from widening it.

Test that a loaded plugin's declaration cannot resolve or use either private capability.
Keep passing tests for the compiled terminal handoff and Slack client. Use a fake fetch to
verify that a rejected account destination causes no network request.
