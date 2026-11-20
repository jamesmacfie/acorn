# X-1. Cloud account access can authorize Slack turns on the Node

Found November 20, 2026, in Acorn at `90b9e61e3` and `acorn-cloud` at `19fa594`. Severity
is critical for the combined path. The authorization gaps are confirmed from source. Command
execution depends on the configured harness and its effective policy. Status is open.

## Evidence and impact

The hosted gateway lets account holders link a Slack identity to a Node the account owns.
On a Node without active links, a sender-routed delivery can cause the plugin to import a
cloud link. Reading **Settings → Slack** also imports new links and replaces a changed
identity. The Node never asks a paired device to approve the identity before authorizing work.

- `plugins/slack/src/server/settings.ts` syncs cloud links from a device's settings read and
  from the first sender-routed delivery. The delivery path matches the installation and omits
  the Node ID check.
- `plugins/slack/src/server/store.ts` can replace the Slack identity for an installation.
  `plugins/slack/src/server/plugin.ts` holds the approval preference in process memory, where it
  can carry over to unrelated links. Active threads and their queued messages lack a link version.
- `plugins/slack/src/server/turns.ts` uses the default harness for Slack work.
  `plugins/agents/src/server/sessions/sessionExecute.ts` gates plugin sessions and refuses known
  unguarded settings. It accepts Auto mode and allows a harness that reports no matching policy
  option. Classifier-approved commands can run without a person's approval under Claude Auto.

An account compromise can grant a different Slack identity access to an online Node with remote
access and the Slack integration available. [C-3](./c-3-email-code-budget-resets.md) tracks one
route to account takeover. Separately, the service signs gateway deliveries. If its signing
authority is compromised, a local link alone cannot prove the sender in that service's payload.
On a linked Node, that weakness reaches both prompts and, when Slack approvals are enabled,
permission responses.
The [gateway route](../../authentication/gateway-routes.md) checks the service, Node, account,
plugin, and replay state. The delivery identity still comes from the gateway.

## Fix and verification

- Require a paired device to confirm the exact Node, Slack installation, and Slack user. Tie
  the approval preference to that single link attempt. Treat cloud sync and incoming delivery as
  discovery, and require a fresh confirmation for any changed identity.
- Bind pending cards, threads, and queued work to the approved link. Invalidate that authority on
  unlink or relink and recheck it at dispatch.
- Enforce a Node-owned execution policy for Slack-originated sessions. Require local approval for
  host execution even when the harness defaults to Auto or cannot report its policy. If protection
  against a compromised gateway is a requirement, require an independently authenticated origin
  for unattended remote work.

Test that a cloud-only link, a wrong-Node delivery, and a replacement identity remain inactive.
Verify that link options apply only to their own request and that queued work stays inactive after
revocation. Use a fake harness to verify that untrusted Slack input cannot run a host command
without the required owner approval.

See [S-5](./s-5-gateway-token-lifetime-not-capped.md) for gateway token lifetime and
[the account-service trust boundary](../../security/control-plane.md#the-account-service) for
the Node's relationship with the service.
