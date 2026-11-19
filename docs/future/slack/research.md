# Research for the Slack plugin

Date: November 19, 2026. Status: research for [the Slack plan](./README.md). Every Slack fact on this
page came from memory of Slack's documentation, not a fresh read. Check each one against
[Slack's API documentation](https://api.slack.com/) before the phase that relies on it, and note the
answer in that phase file.

## The rough.app orchestrator

Source: [the orchestrator guide on rough.app](https://rough.app/orchestrator) and its plain-text copy,
read November 19, 2026. The page says the orchestrator wrote it from its own scripts and notes, so it
describes one team's setup, not a product. Part of the middle of the page was read only as a summary.

### How it works

The orchestrator is one Claude Code session that runs all the time in tmux on a Linux server, with
permission checks off. It answers questions itself. For code work it writes a brief and starts a child
session in its own worktree and branch. The child runs the repository's checks, pushes, and opens a
draft pull request, and a hook refuses a push the checks didn't pass at that commit.

Slack reaches it by polling, not events. A script calls `conversations.history` and
`conversations.replies` every 10 seconds with a bot token, so the app needs no public address. Each
new message becomes one line that Claude Code's Monitor tool turns into a notification. A top-level
message counts only when it @-mentions the bot. Once the bot has posted or been mentioned in a
thread, every human reply in that thread counts, with or without a mention.

A message counts as human when it has a user ID, isn't from the bot, has no `bot_id`, and has no
subtype other than `thread_broadcast` or `file_share`. An edit counts again, once per revision. A
folder of empty files records each message it delivered, so nothing arrives twice and messages sent
while it was down arrive when it returns. The first run records the channel's history without
announcing any of it.

Its rules for Slack:

- React with 👀 before doing anything else.
- Reply only in the thread. The reply script refuses to post without one.
- Send one message per finished piece of work, leading with the link and any decision the person
  must make.
- Re-read the thread before replying, because a reply without a mention might not have arrived.
- Never paste a secret into Slack.
- Open draft pull requests only. Never merge or force-push.

Anyone who can post in the channel can instruct it. Slack has no approval step. The human gate is the
draft pull request and a protected base branch.

### What Acorn takes, and what it changes

Acorn takes the 👀 on arrival, the thread-only replies, the one message per finished piece of work
with the link first, the test for a human message, the delivery-once record, and the shape of a child
in its own worktree, which here is a task per thread.

Acorn changes four things:

- **Events, not polling.** Slack's 2025 limits on reading history make polling unworkable for an app
  that's installed in other people's workspaces.
- **Identity.** Only the owner's linked Slack user steers. On rough.app, anyone in the channel can.
- **Permission checks stay on.** Slack turns run gated, and approvals come back to Slack.
- **Each person's own Node, not one server.** A closed laptop is an offline Node, so Slack suits a
  Node that stays on ([a Node for other machines](../node-tray/README.md)).

## Slack platform facts

Check each row before the phase named in its last column.

| Fact | What the plan does with it | Phase |
| --- | --- | --- |
| The Events API posts to one request address per app, for every workspace that installed it. Answer with a 2xx within 3 seconds, or Slack retries up to three times with `X-Slack-Retry-Num`. Each event has an `event_id`. | One hosted endpoint for everyone. The gateway answers first and delivers after, and drops a retry it has seen. The Node drops a message it has seen. | 1 |
| A request is signed: `X-Slack-Signature` is `v0=` and an HMAC-SHA256 of `v0:<timestamp>:<body>` with the app's signing secret. Refuse a timestamp more than five minutes old. | Only the gateway holds the signing secret. | 1 |
| Socket Mode allows up to 10 connections per app, and Slack sends each event to one of them, not to all. | Nodes can't share one app over Socket Mode. | 1 |
| Since May 29, 2025, an app distributed outside the Slack Marketplace may call `conversations.history` and `conversations.replies` once a minute, for at most 15 messages. Internal apps and Marketplace apps keep the older limits. | The Node keeps its own record of each thread's messages. It reads Slack's history once, when the bot is mentioned partway through a thread. | 4 |
| `chat.postMessage` allows about one message per second per channel. `chat.update`, `reactions.add`, and `reactions.remove` are Tier 3, about 50 a minute, for the app in one workspace. | Every Node in a workspace shares one budget. The gateway splits it per Node, and status edits are the first thing dropped. | 1 and 4 |
| A message's `text` holds up to 40,000 characters, a section block's text up to 3,000, and a message up to 50 blocks. The `markdown` block takes standard Markdown, up to 12,000 characters per message. | Answers go in a `markdown` block, cut at its limit. | 4 |
| With `chat:write.customize`, a post can set its own `username` and icon. | Posts read "Acorn · James", so people can tell whose agent is talking. | 1 |
| A button click posts a signed payload, with the clicker's user ID, to the app's interactivity address. The app answers within 3 seconds. Ephemeral messages can carry buttons. A `response_url` on the payload can replace or delete the message that held the button for 30 minutes. | Approvals and the project picker. | 3 and 5 |
| A slash command posts to the app's command address, and the app answers within 3 seconds. | `/acorn`. | 3 |
| Sign in with Slack, over OpenID Connect, returns the person's user ID and team ID. | Linking proves which Slack user is the owner. | 1 |
| Bot events: `app_mention`, `message.channels`, `message.groups`, `message.im`, and `message.mpim`. Removal events: `app_uninstalled` and `tokens_revoked`. | The events the app subscribes to. | 1 |
| Scopes: `app_mentions:read`, `channels:history`, `groups:history`, `im:history`, `mpim:history`, `chat:write`, `chat:write.customize`, `reactions:write`, `commands`, and `users:read`. | The install asks for these. `files:read` waits until files are supported. | 1 |
| `chat.startStream`, `chat.appendStream`, and `chat.stopStream` stream one message as it's written. The assistant pane gives an app its own panel, with `assistant.threads.setStatus` for a "thinking" line. | Later. Either could replace the edited status line. | Later |

### Checked on November 19, 2026

Setting up a test app and workspace confirmed these:

- Slack accepted [the manifest](../../account-api/slack-app.md#the-manifest) as written, including the
  **Messages** tab, `chat:write.customize`, and the `openid` and `profile` user scopes.
- **Paste a manifest** creates the app and installs it in the chosen workspace in one step. It then
  shows a bot token, a user token, and an app-level token, even with Socket Mode off.
- Slack saved the slash command and interactivity addresses with nothing answering them.
- A developer sandbox needs a Slack Developer Program account under the same email as the signed-in
  Slack user. Without one, `slack sandbox list` answers `developer_not_found`.
- `slack sandbox create` prints an `.enterprise.slack.com` address. `slack sandbox list` prints a
  `.slack.com` address that shows Slack's error page.
- A basic sandbox is archived after a month without use.
- The Slack CLI's `slack api` doesn't use the CLI's own sign-in, so it can't create an app from a
  manifest without a project around it.
- Slack publishes a Claude Code plugin, `slack@slack` from the `slackapi/slack-skills-plugin`
  marketplace. Its skills cover the Slack CLI, Block Kit, the Web API, and testing. Its
  `create-slack-app` skill scaffolds a Bolt starter project, which this plan doesn't use.

`message.channels` sends every message in every public channel the bot was invited to, not only the
ones meant for it. The gateway forwards a message only when a [routing rule](../../account-api/slack-gateway.md#routing)
matches, and keeps nothing from the rest.

## Alternatives rejected

**A Slack app per person, over Socket Mode.** Nothing hosted, no relay, and the Node holds its own
tokens. Rejected because each person needs their own bot, and often an admin's approval for it, and
James wanted one @acorn per workspace. The plugin's handling doesn't depend on how an event arrived,
so this could come back later as a second way to connect, for people who run their own relay.

**Polling.** The 2025 history limits rule it out for an app installed outside one company.

**Events straight to each Node through the relay's preview listener.** A Node already holds a public
certificate for its preview names, so Slack could post to one while the relay reads nothing. A Slack
app has one request address, though, so this needs an app per Node, the first alternative again.

**A second socket from each Node to the gateway.** Simpler for the hosted side. It duplicates the relay
tunnel, keeps a second connection open on every Node, and gives up the Node's own routes, auth, and
tests. The relay route needs no relay change.

**Guest messages as session notes.** `agents:session-messenger` labels a note as not from the person,
which suits a guest. But a note always starts a turn of its own, so every guest reply would spend the
owner's usage ([session messages](../../managed-agents/session-messages.md)).

**A loaded plugin.** [Slack § Why](../../integrations/slack.md#why) says why the plugin is compiled
in.
