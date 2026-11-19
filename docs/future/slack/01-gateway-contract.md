# Phase 1: the Slack gateway contract

Date: November 19, 2026. Status: proposed. Depends on nothing.

## Goal

Write the Slack gateway API, version 1, as a public contract beside [the account API](../../account-api.md):
its routes, how it picks a Node, what it stores, the token it signs, its schema, and a stand-in with a
fake Slack that every later phase tests against. The hosted gateway is built from this contract in
the hosted service's own repository.

## Starting point

- The account service signs relay credentials, tickets, and assertions with Ed25519. The token types
  are `TOKEN_TYPES` in `packages/protocol/src/device/account.ts`, and the format is in
  `packages/protocol/src/device/accountToken.ts`.
- The account API's request and response types are in `packages/protocol/src/device/account.ts`, and
  its schema is `docs/schemas/account-v1.json`.
- `startAccountStub` in `packages/node-core/src/testkit/accountStub.ts` is the stand-in, and
  `pnpm dev:account` runs it ([test an account service](../../account-api/testing.md)).
- The relay needs no change. The gateway opens a stream as any client does.

## In scope

- The routes Slack calls, the routes a Node calls, and how the gateway reaches a Node.
- The routing rules, the gateway token, the stored rows, and the errors.
- Types in `packages/protocol/src/device/slackGateway.ts` (new) and the schema in
  `docs/schemas/slack-gateway-v1.json` (new), generated and pinned like the account schema.
- The stand-in and a conformance suite.

## Out of scope

The hosted implementation, its storage, and its deployment. Enterprise Grid. Marketplace review.

## The Slack app

Any service that answers this contract runs as one Slack app, made from this manifest. Replace
`ACCOUNT_SERVICE` with the service's address. Slack accepted this manifest on November 19, 2026, `user`
scopes included:

```json
{
  "display_information": {
    "name": "Acorn",
    "description": "Talk to your Acorn agents from Slack."
  },
  "features": {
    "app_home": {
      "messages_tab_enabled": true,
      "messages_tab_read_only_enabled": false
    },
    "bot_user": { "display_name": "acorn", "always_online": true },
    "slash_commands": [
      {
        "command": "/acorn",
        "url": "https://ACCOUNT_SERVICE/slack/v1/commands",
        "description": "Set your project or mode for this channel, or get help.",
        "usage_hint": "project <name> | mode tasks|conversation | help",
        "should_escape": false
      }
    ]
  },
  "oauth_config": {
    "redirect_urls": ["https://ACCOUNT_SERVICE/slack/v1/oauth/callback"],
    "scopes": {
      "bot": [
        "app_mentions:read",
        "channels:history",
        "groups:history",
        "im:history",
        "mpim:history",
        "chat:write",
        "chat:write.customize",
        "reactions:write",
        "commands",
        "users:read"
      ],
      "user": ["openid", "profile"]
    }
  },
  "settings": {
    "event_subscriptions": {
      "request_url": "https://ACCOUNT_SERVICE/slack/v1/events",
      "bot_events": [
        "app_mention",
        "message.channels",
        "message.groups",
        "message.im",
        "message.mpim",
        "app_uninstalled",
        "tokens_revoked"
      ]
    },
    "interactivity": {
      "is_enabled": true,
      "request_url": "https://ACCOUNT_SERVICE/slack/v1/interactions"
    },
    "org_deploy_enabled": false,
    "socket_mode_enabled": false,
    "token_rotation_enabled": false
  }
}
```

Set up the app in this order:

1. Create it in a workspace that lasts, not a test sandbox. As far as we know, an app goes with the
   workspace it was made in.
2. Leave out `event_subscriptions` at first. Slack checks the events address when it's saved, so add
   the block once the gateway answers that check. Slack saved the slash command and interactivity
   addresses on November 19, 2026, with nothing answering them.
3. Turn on public distribution before installing the app in any other workspace.

The service keeps the client ID, the client secret, the signing secret, and a key that encrypts the bot
tokens it stores. Creating the app also shows a bot token, a user token, and an app-level token for its
home workspace. The service needs none of them: it gets each workspace's bot token through
**Add to Slack**, and the app-level token is for Socket Mode.

`messages_tab_enabled` matters. Without the **Messages** tab, nobody can DM the bot, and DMs are where
conversation mode starts.

## Install

**Add to Slack** on the account website runs Slack's OAuth v2 flow with the scopes in
[research](./research.md#slack-platform-facts). The gateway stores the team's ID and name, the bot's
user ID and bot ID, and the bot token, encrypted. An `app_uninstalled` or `tokens_revoked` event
deletes the install with its links and grants.

## Link a Slack user

A Node starts a link for its owner. The Node calls these routes with the account's access token:

| Route | What it does |
| --- | --- |
| `POST /slack/v1/links` | Takes `{ nodeId }`. Answers `{ url, expiresAt }`, an address on the account website that runs Sign in with Slack. The address lasts 10 minutes. |
| `GET /slack/v1/links` | Answers `{ links: [{ teamId, teamName, slackUserId, slackUserName, nodeId }] }` for the account. The Node polls it while a link is in progress. |
| `DELETE /slack/v1/links/{teamId}` | Removes the account's link in that team, and every grant its Node holds there. |

Signing in to Slack proves the team and the user. When the team has no install, the page offers
**Add to Slack** first. One Slack user in one team links to one account and one Node. Linking again
from another Node moves the link. A Slack user already linked to another account gets `409 conflict`.

Whether the owner answers approvals from Slack is kept on the Node, not here. The gateway can't change
it.

## Routing

The gateway checks each request's Slack signature and timestamp, answers Slack, and drops an
`event_id` it has seen in the last hour. Then it picks a Node for the event, by the first rule that
matches:

1. **A bot's message is dropped**, the app's own included: a `bot_id`, or the bot's user ID.
2. **A thread grant wins.** When `(teamId, channelId, threadTs)` has a grant, the event goes to that
   Node with `routedBy: "grant"`, whoever sent it.
3. **A linked sender's mention or DM** goes to that sender's Node with `routedBy: "sender"`. An
   `app_mention`, or a top-level `message.im`, counts. When the Node answers 2xx, the gateway records
   a grant for the thread the message starts or sits in.
4. **An unlinked sender's mention or DM** gets an ephemeral note from the gateway with a link to
   connect.
5. **Everything else is dropped**, and nothing from it is kept.

A button click goes to the Node holding the grant for the thread its message sits in, or to the
clicker's Node for an ephemeral message outside a thread. A slash command goes to the sender's Node,
and an unlinked sender gets the link note.

When the relay answers `404`, `502`, or `504` for a mention, DM, click, or command, the sender gets
"Your Node (<label>) is offline, so nothing was sent." A grant-routed reply from someone else is
dropped without a note.

## Deliver to a Node

1. Sign a relay ticket for the Node's owner account, as `POST /account/v1/tickets` would.
2. Open `wss://<relay>/v1/connect/<nodeId>?kind=tls` with it.
3. Run TLS 1.3 inside the stream, pinning the fingerprint the Node registered.
4. Send `POST /v1/gateway/slack/events` with `Host: <nodeId>.relay.acorn`, a gateway token in
   `Authorization`, and `{ eventId, routedBy, kind, payload }`. `kind` is `event`, `interaction`, or
   `command`, and `payload` is Slack's JSON as Slack sent it.
5. The Node answers `200 { "ok": true }` within 10 seconds. The gateway tries a failed connection once
   more and never retries a `4xx`.

`RelayAgent` in `packages/custody/src/broker/relaySocket.ts` already does steps 2 and 3 for clients.

### The gateway token

A gateway token is a fourth token type beside the three in
[the account API](../../account-api.md#signed-tokens), signed with the same keys:

| Token | `typ` | Claims | Lifetime |
| --- | --- | --- | --- |
| Gateway token | `acorn-gateway+jwt` | `iss`, `sub` (the Node's owner account), `aud` (the Node ID), `jti`, `iat`, `exp`, `scope` (`slack`) | 60 seconds, one request |

The gateway signs one per delivery. It names no Slack user, because the Node reads the sender from the
payload.

## Calls from a Node

`POST /slack/v1/calls` takes `{ teamId, method, args }` with the account's access token, makes the
Slack call with the team's bot token, and answers `{ ok: true, result }` with Slack's answer. The
gateway allows these methods and checks each against the calling Node's grants:

| Method | Allowed when |
| --- | --- |
| `chat.postMessage` | `thread_ts` names a thread this Node holds, or `channel` is the owner's DM with the bot. The gateway sets `username` to "Acorn · <owner's Slack name>" and refuses `reply_broadcast`. |
| `chat.update`, `chat.delete` | The message is the bot's, in a thread this Node holds. |
| `chat.postEphemeral` | The message goes to the owner anywhere, or to anyone in a thread this Node holds. |
| `reactions.add`, `reactions.remove` | The message is in a thread this Node holds. |
| `conversations.replies` | The thread is one this Node holds. |
| `chat.getPermalink` | The message is in a thread this Node holds. |
| `users.info` | The user is in the team. |
| `respond` | Not a Slack method: posts `args.body` to `args.url`, a `response_url` whose host is `hooks.slack.com`. |

`DELETE /slack/v1/grants/{teamId}/{channelId}/{threadTs}` gives a thread up. The Node calls it when a
task is archived. A grant with no delivery for 90 days lapses.

The gateway keeps each Node to a share of the team's Slack budget. Over its share, a call answers
`429 rate_limited` with `retryAfter` in seconds.

## Errors

The shape and the codes are the account API's. These are added:

| Code | Status | Meaning |
| --- | --- | --- |
| `not_installed` | 404 | The app isn't installed in that team. |
| `not_linked` | 404 | The account has no link in that team. |
| `not_granted` | 403 | The call names a thread or message this Node doesn't hold, or a method outside the list. |
| `rate_limited` | 429 | The Node's share of the budget is spent. |
| `slack_error` | 502 | Slack refused the call. `message` holds Slack's error string. |

## What the gateway stores

| Row | Fields | Kept until |
| --- | --- | --- |
| Install | Team ID and name, bot user ID, bot ID, bot token, encrypted | The app is removed |
| Link | Account ID, team ID, Slack user ID, Slack display name, Node ID | Unlink, removal, or the Node leaves the account |
| Grant | Team ID, channel ID, thread timestamp, Node ID, last delivery time | Given up, unlinked, or 90 days idle |
| Seen events | `event_id` | One hour, in memory |

No message text, answer, command line, or file is stored.

## The stand-in

`startAccountStub` gains a `slack` member, with a fake Slack in
`packages/node-core/src/testkit/slackStub.ts` (new):

- `installTeam`, `link`, and `unlink` set up a fake workspace and its users.
- `mention`, `reply`, `dm`, `click`, and `command` build payloads the way Slack does and send them
  through the routing rules, over a real relay, with real gateway tokens.
- `calls()` lists every Slack call a Node made, with the stand-in's answers. A call can be made to
  answer `429`.

`pnpm dev:account` serves it, so `pnpm dev:agent` can link a fake Slack user.

The fake Slack also runs on its own, in front of any service that answers this contract. Started
standalone, it signs each event, click, and command with a signing secret it's given, posts them to
the service's `/slack/v1/events`, `/interactions`, and `/commands`, and answers the service's Web API
calls itself. The conformance suite drives a service under test this way. So a service must read
Slack's Web API address and its signing secret from its settings. It may accept an address that isn't
Slack's only in a test mode, so a production service can't be pointed somewhere else.

## Verify before building

- Every row in [the Slack facts](./research.md#slack-platform-facts) marked for phase 1.
- Whether Sign in with Slack can share the bot's app, or needs a separate client. Answered November
  19, 2026: it can share the app. Slack accepted `openid` and `profile` as user scopes in the bot's
  manifest, and issued a user token at install.
- Whether a top-level `message.im` arrives as well as, or instead of, an `app_mention` for a DM.

## Tests

- The schema matches the types, and regenerates with a flag, like the account schema.
- The conformance suite covers each route, each routing rule, each error, and the calls table.
- A stand-in mention reaches a test route on a real Node through a real relay, and a replayed token
  is refused.

## Checkpoint

Run the conformance suite against the stand-in. Then inject a mention from an unlinked user, and
check that the fake Slack recorded one ephemeral note and that nothing reached a Node. Record the
date and the result here.
