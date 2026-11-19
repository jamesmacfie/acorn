# The Slack gateway API

The Slack gateway is part of the account service. It receives Slack's events for the one shared Acorn
Slack app, picks the Node each one belongs to, delivers it through the relay, and makes the Slack calls
a Node asks for with the workspace's bot token. Read this page to build a gateway, or to change what
the Slack plugin ([Slack](../integrations/slack.md)) sends or expects.

The types are the Slack gateway section of `packages/protocol/src/device/account.ts`, and the published
schema is `docs/schemas/slack-gateway-v1.json`. The
API has its own version in its path, `/slack/v1`. The rules of [the account API](../account-api.md#version-and-shape)
apply: requests are strict, answers are open, and v1 changes only by addition.
[The Slack app](./slack-app.md) has the app's manifest and setup.

## Routes

| Route | Caller | What it does |
| --- | --- | --- |
| `POST /slack/v1/events` | Slack | Events, signed. Answers `url_verification` with its `challenge`. |
| `POST /slack/v1/interactions` | Slack | Button clicks and selects, signed, as a form with `payload`. |
| `POST /slack/v1/commands` | Slack | `/acorn`, signed, as a form. |
| `GET /slack/v1/oauth/callback` | Slack | The end of **Add to Slack** and of Sign in with Slack. |
| `POST /slack/v1/links` | A Node | Takes `{ nodeId }`. Answers `{ url, expiresAt }`, a page on the account website that runs Sign in with Slack. It lasts 10 minutes. |
| `GET /slack/v1/links` | A Node | Answers `{ links: [{ teamId, teamName, slackUserId, slackUserName, nodeId }] }` for the account. |
| `DELETE /slack/v1/links/{teamId}` | A Node | Removes the account's link in that team, and the grants its Node holds there. |
| `POST /slack/v1/calls` | A Node | A Slack call, by [the calls table](#calls-from-a-node). |
| `DELETE /slack/v1/grants/{teamId}/{channelId}/{threadTs}` | A Node | Gives a thread up. |

A Node calls its routes with the account's access token. The gateway checks Slack's signature on the
other three: `X-Slack-Signature` is `v0=` and an HMAC-SHA256 of `v0:<timestamp>:<body>` with the app's
signing secret, and a timestamp more than five minutes old is refused. It answers Slack within three
seconds and drops an `event_id` it has seen in the last hour.

## Links

Signing in to Slack proves the team and the user. When the team has no install, the page offers
**Add to Slack** first. One Slack user in one team links to one account and one Node, and linking again
from another Node moves the link. A Slack user already linked to another account gets `409 conflict`.
Whether the owner answers approvals from Slack is kept on the Node, so the gateway can't change it.

An `app_uninstalled` or `tokens_revoked` event deletes the install with its links and grants.

## Routing

The gateway picks a Node for each event by the first rule that matches:

1. **A bot's message is dropped**, the app's own included: a `bot_id`, or the bot's user ID.
2. **A thread grant wins.** When `(teamId, channelId, threadTs)` has a grant, the event goes to that
   Node with `routedBy: "grant"`, whoever sent it.
3. **A linked sender's mention or DM** goes to the sender's Node with `routedBy: "sender"`. An
   `app_mention` counts, and so does a `message` in a DM that isn't in a thread. When the Node answers
   2xx, the gateway records a grant for the thread the message starts or sits in.
4. **An unlinked sender's mention or DM** gets an ephemeral note with a link to connect.
5. **Everything else is dropped**, and nothing from it is kept.

A click goes to the Node holding the grant for the thread its message sits in, or to the clicker's
Node for an ephemeral message outside a thread. A slash command goes to the sender's Node. An unlinked
sender gets the connect note.

When the relay answers `404`, `502`, or `504`, or nothing answers, for a mention, DM, click, or
command, the sender gets "Your Node (<label>) is offline, so nothing was sent." A grant-routed reply from
anyone but the Node's own linked user is dropped without a note.

Slack sends a mention in a channel twice, as `app_mention` and as `message`. Both reach the Node, which
drops the second by the message's timestamp.

## Deliver to a Node

1. Sign a relay ticket for the Node's owner account, as `POST /account/v1/tickets` would.
2. Open `wss://<relay>/v1/connect/<nodeId>?kind=tls` with it.
3. Run TLS 1.3 inside the stream, and check the certificate's SHA-256 against the fingerprint the Node
   registered before sending anything.
4. Send `POST /v1/gateway/slack/events` with `Host: <nodeId>.relay.acorn`, a gateway token in
   `Authorization`, and `{ eventId, routedBy, kind, payload }`. `kind` is `event`, `interaction`, or
   `command`. `payload` is Slack's JSON as Slack sent it: the whole event callback, with `team_id` and
   `event`, a click's payload, or a command's fields. A click or a command has no `event_id`, so
   `eventId` is one the gateway makes.
5. The Node answers `200 { "ok": true }` within 10 seconds, before it does the work. The gateway
   tries a failed connection once more and never retries a status.

A Node checks the token and the route ([gateway routes](../authentication/gateway-routes.md)).

### The gateway token

A gateway token is a fourth token type beside the three in
[the account API](../account-api.md#signed-tokens), signed with the same keys:

| Token | `typ` | Claims | Lifetime |
| --- | --- | --- | --- |
| Gateway token | `acorn-gateway+jwt` | `iss`, `sub` (the Node's owner account), `aud` (the Node ID), `jti`, `iat`, `exp`, `scope` (`slack`) | 60 seconds, one request |

The gateway signs one per delivery. It names no Slack user, because the Node reads the sender from the
payload and checks it against its own record of the owner.

## Calls from a Node

`POST /slack/v1/calls` takes `{ teamId, method, args }`, makes the Slack call with the team's bot
token, and answers `{ ok: true, result }` with Slack's answer. The gateway allows these methods, each
checked against the calling Node's grants:

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

A grant with no delivery for 90 days lapses. The gateway keeps each Node to a share of the team's
Slack rate budget. Over its share, a call answers `429 rate_limited` with `retryAfter` in seconds.

## Errors

The shape is the account API's, `{ error, message? }`, with `retryAfter` for `rate_limited`. These
routes answer `invalid_request`, `invalid_token`, `not_found`, and `conflict` as the account API does,
and these codes of their own:

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

`startAccountStub` has a `slack` member: the gateway, in
`packages/node-core/src/testkit/slackGatewayStub.ts`, in front of a fake Slack in
`packages/node-core/src/testkit/slackStub.ts`. The gateway delivers over a real relay with real
gateway tokens, and the fake Slack signs what it sends, so a Node can't tell the stand-in from the
hosted gateway. The test methods:

- `installTeam` adds a workspace and installs the app. `link`, `unlink`, and `addUser` set up people.
- `mention`, `reply`, `dm`, `click`, `command`, and `event` send what Slack would, through the routes
  above.
- `calls()` lists every Slack call made, with its status. `rateLimitNext(method)` makes the next one
  answer `429`. `grants()` lists the grants.

The link page takes `?team=&user=&name=` in place of Sign in with Slack. Without them, it links a user
named `owner` in a workspace called Acorn Dev. `pnpm dev:account` serves it, and `POST
/_test/slack/<mention|reply|dm|click|command>` with the method's JSON drives the fake Slack from a
shell. `GET /_test/slack/calls` lists the calls.

The stand-in delivers before it answers Slack, so a test that awaits a send sees the result. It doesn't
split a team's rate budget, and its grants don't lapse.

## Test an implementation

`packages/node-core/src/testkit/slackGatewayContract.test.ts` checks the routes a Node calls, their
errors, Slack's signature, and the routing rules that end without a delivery.
`apps/relay/src/slackGateway.test.ts` runs a real Node through a real relay: linking from
**Settings → Slack**, a delivered mention and the Node's answers, a non-owner's command, and an
offline Node. `packages/node-core/src/server/accountSchema.test.ts` pins the schema; regenerate it with
`UPDATE_ACCOUNT_SCHEMA=1`.

A gateway under test reads Slack's Web API address and its signing secret from its settings. It may
take an address that isn't Slack's only in a test mode, so a production service can't be pointed
anywhere else. The fake Slack in `slackStub.ts` runs on its own with `startFakeSlack`, and signs for
any gateway `setGateway` names.
