# App-access approval

When a Codex agent asks Computer Use to operate an app, acorn shows a consent card with the scopes
Computer Use allows. This page covers the request shape, who keeps the grant, and the checks on an
answer. `plugins/agents/src/server/drivers/codexAppApproval.ts` reads the request, and
`plugins/agents/src/client/sessions/appApproval.ts` holds the card's words.

## The request

Computer Use sends a consent form through the app-server's `mcpServer/elicitation/request`. Its
`_meta` names the app by bundle identifier in `tool_params.app`, gives its readable name in
`tool_params_display`, and lists the allowed scopes in `persist`: `['session', 'always']`, or
`['session']` when policy forbids a saved grant. The Codex adapter reads that into a typed `approval`
on the request event.

The card offers **Allow for this session**, **Always allow** only when `always` was offered, and
**Decline**. It names the app by name and identifier, explains both scopes before any button, and
shows any warning Computer Use attached. The desktop and the terminal client draw the same card.

## Who keeps the grant

Computer Use owns every grant, and acorn stores only the decision. The answer goes back as
`_meta: { persist: 'session' | 'always' }`. The integration's `node_repl` keeps a session grant per
Codex thread under `$CODEX_HOME/computer-use/sessions/` and an always grant in its own approvals file.
It answers later requests it holds a grant for, so those don't reach acorn.

A Codex thread is one managed session, so a session grant lasts as long as the session, and a fork
asks again. A grant belongs to the computer the agent runs on, which for a remote Node is that Node's
computer. Nothing syncs grants across Nodes or devices.

To revoke an always grant, use Computer Use's settings in the ChatGPT app. acorn keeps no second list,
because two stores would disagree. A sent answer doesn't prove the grant was saved, so the settled
card says Computer Use saves it and where to revoke it.

**Always allow** trusts an app identifier, not only windows the agent launched. The agent test app has
its own identifier for this reason
([agent drivers](../local-development/agent-drivers.md#native-control-of-a-session)).

## Checks on an answer

The descriptor is an optional part of the stored request. A request with missing, malformed,
oversized, or foreign metadata reads as plain Allow and Decline. An app identifier too long to store is
refused, not cut, because a shorter bundle identifier names another app. A form with fields stays a
question whatever its metadata says.

Before claiming an answer, the runtime checks it against the options the stored request offered. The
adapter then rebuilds the response from the provider's original request, so a forged option, an
unoffered scope, or a changed target can't reach Computer Use. The route is device-only
([HTTP control authority](./sessions.md#http-control-authority)), so an agent can't approve its own
access.

## Limits

The request shape was read from the integration's source: Codex Computer Use 26.915.1001093, `@oai/sky`
0.7.5, and codex-cli 0.159.2. A live capture and the grant lifetimes still need a real run
([Computer Use approval checks](../testing/computer-use.md)).
