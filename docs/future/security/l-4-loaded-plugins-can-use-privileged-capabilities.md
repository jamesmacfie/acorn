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
