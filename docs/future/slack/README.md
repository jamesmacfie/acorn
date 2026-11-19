# Slack for Acorn agents

Date: November 19, 2026. Status: phases 1 to 5 built on November 19, 2026, against the stand-in. The
hosted gateway and [phase 6, acceptance](./06-acceptance.md), are left.

Mention @acorn in a Slack channel, or DM it, and an agent starts work on your own Node. What shipped is
described in its owning pages:

| Contract | Owning page |
| --- | --- |
| The Slack plugin, its modes, linking, turns, and approvals | [Slack](../../integrations/slack.md) |
| When the bot acts, what it posts, and what the agent is told | [Slack conversation rules](../../integrations/slack/conversation-rules.md) |
| The Slack gateway API, the gateway token, and the stand-in | [The Slack gateway API](../../account-api/slack-gateway.md) |
| The Slack app's manifest and setup | [The Slack app](../../account-api/slack-app.md) |
| `/v1/gateway/<plugin>` routes | [Gateway routes](../../authentication/gateway-routes.md) and [the plugin API](../../plugins/plugin-api.md#gateway-routes) |
| `agents.requestAnswer`, and `onTurn` on `agents.sessionExecute` | [Session control](../../managed-agents/session-control.md#answering-a-request-from-a-plugin) |
| What a breached hosted service could do | [Control plane security](../../security/control-plane.md#the-account-service) and [remote access](../remote-access/README.md#rules-no-phase-may-break) |

[Research](./research.md) covers the rough.app orchestrator this design learns from, and the
alternatives rejected.

## What's left

1. **The hosted gateway**, built in the hosted service's own repository against
   [the gateway API](../../account-api/slack-gateway.md): **Add to Slack**, Sign in with Slack on the
   account website, encrypted bot tokens, the per-Node share of a team's rate budget, and grants that
   lapse after 90 days idle. The stand-in does none of the last four. Its conformance runs with the
   standalone fake Slack (`startFakeSlack`), as [acceptance](./06-acceptance.md) stage 2 describes.
2. **The event subscriptions** on the production app, once the gateway answers Slack's address check.
3. **[Acceptance](./06-acceptance.md)**: the stand-in walk in `pnpm dev:agent`, the live run, and the
   release.

Left out of the first version on purpose, as the plan decided: a list of other Slack users whose
messages become turns, reactions as triggers, a **Stop** button, files and images, watching a channel,
holding messages for an offline Node, team Nodes, forks and several agents in one thread, bell notices
in a DM, Slack's assistant pane and streamed messages, and a Marketplace listing.

## Decisions made while building

- **The task doesn't link to its Slack message.** Task links need a provider connection, and the Node
  holds no Slack one, so a `links` field on the root seed would have had nothing to stamp. The plugin
  keeps the thread in its own rows.
- **`createRoot` takes `branch: null`** for conversation mode's branchless task in the project folder.
  Left out, a git project's root task still gets a branch derived from its title.
- **The plugin binds `agents.sessionExecute` for itself**, so a Slack turn gets the loaded copy's rules:
  gated, an unguarded harness refused, and "by slack" on the session.
- **A known key's value withholds the whole text.** The known-values matcher names the keys a text
  holds but not where, so a post that holds one says so and points to Acorn. Anything the secret
  detector finds is cut out in place.
- **All the plugin's work runs in one queue**, so a delivery, an agents event, and a turn starting never
  interleave. Only the agent call runs outside it.
- **The Slack gateway types are a section of `packages/protocol/src/device/account.ts`.** The protocol
  package is at its 99-entry cap, and a module named for a plugin fails the protocol naming check.

## Verify-before-building answers

Settled November 19, 2026, from the code unless marked:

| Question | Answer |
| --- | --- |
| Does the Node fetch the account keys again for an unknown `kid`? | No. A rotated key is unknown until the Node registers again. Documented as a limit. |
| Where do principal types live, and does a fourth kind fit? | `packages/node-core/src/server/middleware/auth.ts`. A gateway principal never enters it: the gateway route answers before `requireUser` and hands its handler the principal directly. |
| How does the listener mark a relayed socket? | It doesn't. A relayed stream has no peer address and the relay `Host`, and a phone's channel sets `browserChannel`. The route checks all three. |
| Does a compiled caller's session get `startedByPlugin`? | Not unbound. The plugin binds its own copy, which sets it. |
| What does `sessionExecute`'s timeout do? | It cancels the step's turns. Slack turns ask for four hours. |
| Does `sessionExecute` queue a call for a busy session? | `enqueueTurn` queues it. The plugin queues per thread anyway. |
| Does any read give a running turn's input? | Not used: a mirrored turn posts when it ends, as the rules say. |
| Does a Slack address fit task links? | No. See the decisions above. |
| Does `createRoot` with no branch use the project folder? | No, it derived a branch. `branch: null` was added. |
| What happens when two new sessions start in one task at once? | Each has its own step ID, so each gets its own session. |
| Does `plugin:agents:sessions-changed` report an archive? | Yes, with `archived: true`. |
| Can `agents:composer-actions` draw a plain label? | Yes, any kit content. The plugin draws "Shared to …" there. |
| Which address opens a task from Slack? | The phone app's `/t/<task ID>` on the account website. Not checked with more than one paired Node. |
| Can an ephemeral message carry a `static_select`? | Yes, up to 100 options, from Slack's docs as recorded, not checked live. |
| Does a DM send `message.im` as well as, or instead of, `app_mention`? | Not checked live. The plugin acts on either, and drops the second by timestamp. |
| Does every harness offer allow-once and reject-once? | Not checked per harness. Without one, the card's click answers "This can't be answered from Slack". |
| Does a harness that times out a request report `expired`? | Not checked per harness. The card reads "Expired." when the event says so, or on the next click. |

## Checkpoints

| Phase | Date | Result |
| --- | --- | --- |
| 1 | November 19, 2026 | `slackGatewayContract.test.ts` against the stand-in passes, including an unlinked user's mention: one ephemeral note, no delivery, no grant. Rechecked against the phase doc the same day: the relay test gained the calls table against a real grant, a grant beating the connect note, and giving a thread up. |
| 2 | November 19, 2026 | `apps/relay/src/slackGateway.test.ts` sends a stand-in delivery through a real relay to a real Node, and `gatewayRoute.test.ts` refuses a replayed token. Not run by hand in `pnpm dev:agent`: the test runs the same steps. |
| 3 | November 19, 2026 | The relay test links from **Settings → Slack** and checks a non-owner's `/acorn`. The plugin tests cover `/acorn project`, `/acorn mode`, and the picker. **Settings → Slack** wasn't opened in `pnpm dev:agent`; left for acceptance step 1. |
| 4 | November 19, 2026 | `plugins/slack/src/server/slack.test.ts` covers both modes, guests, reactions, the status line, answers, mirroring, archives, and a restart, with the agents plugin faked at its contract. No real agent turn ran from Slack; left for acceptance step 1. |
| 5 | November 19, 2026 | The plugin tests cover the card with approvals on and off, the owner's and a guest's clicks, a double click, and an answer in Acorn first. `requestAnswer.test.ts` covers each refusal. Not run against a real harness; left for acceptance step 1. |

The Node service size grew 2,218 B, from 1,952,863 B to 1,955,081 B, measured locally on November 19,
2026, and the ceiling went from 1,953,500 B to 1,955,800 B under James's standing approval.
