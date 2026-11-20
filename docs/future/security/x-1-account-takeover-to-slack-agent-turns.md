> **Completion note, November 20, 2026.** Fixed on the Acorn side, on branch
> `phase-x-1-slack-identity-approval-and-execution-policy`.
>
> What landed:
>
> - A Slack link counts only after a paired device confirms it. `GET /v1/p/slack/state` can only drop or
>   rename local links. A new `POST /v1/p/slack/confirm` takes the workspace, the Slack user ID the page
>   showed, and the approvals choice. It records the link only while the gateway still reports that user
>   for this Node. Otherwise it answers 409 `slack_link_changed`. `linkFromDelivery` is gone, so a
>   delivery never records a link. A different Slack user for a workspace drops the local link and waits
>   for its own confirmation.
> - The approvals choice travels in the confirm request. The in-process `approvalsOnLink` is gone, and
>   `/link` takes no body.
> - Each confirmation mints a `link_id`. Threads and project picks store it. `store.linkOf` checks it in
>   `pump`, again as a turn starts, in `turnChanged`, in restart recovery, before a card posts, and on a
>   click. A click on a card from another workspace's thread no longer answers it either. A thread from
>   an old link ends.
> - `agents.sessionExecute` has a `requireCommandApproval` field, published in `acorn-plugin-types`
>   too. It switches Claude Code to `default` mode after `configOptions` and refuses the turn when the
>   session doesn't report that mode afterward. A provider with no known asking setting is refused.
>   Slack sets it on every turn.
>
> Decisions and deviations:
>
> - Migration `0001_link_confirmation` deletes every existing Slack link and pending pick, and ends
>   every Slack thread. Those links were recorded without a confirmation, so each owner confirms once
>   after upgrading.
> - Codex and contributed harnesses are refused for Slack turns. Codex reports its sandbox profile but
>   not its approval policy, so Acorn can't show that it asks. Supporting Codex needs Acorn to set and
>   read Codex's approval policy.
> - `default` mode still honors the owner's own `permissions.allow` rules and hooks in their Claude
>   settings. I treated those as the owner's choice.
> - **Answer approvals from Slack** still lets a Slack click approve a command. That's the opted-in risk
>   the switch describes. I didn't build an independently authenticated origin for unattended remote
>   work. The finding makes that conditional on defending against a compromised gateway.
>
> What acorn-cloud would still need:
>
> - Nothing for this fix to work. Two things would make it stronger. The gateway could sign each
>   delivery's sender with a key the Node can check apart from the service's routing token. It could
>   also tell a Node when its link changes, so a stale link drops without waiting for the settings page.
>
> For later phases: the bound `agents.sessionExecute` copy behaves the same for loaded plugins unless
> they set `requireCommandApproval`. The review guide and other loaded plugins keep Auto.

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
