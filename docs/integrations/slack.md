# Slack

Mention @acorn in a Slack channel, or DM it, and an agent starts work on your own Node. Its progress,
its permission requests, and its answers come back to the same thread. Read this page to set Slack up,
or to change how the plugin maps Slack onto tasks and sessions. [The conversation
rules](./slack/conversation-rules.md) say when the bot acts, when it stays quiet, and what it posts.

The plugin is `plugins/slack`, compiled into the Node. Its node half is registered in
`apps/node/src/composition/plugins.ts`, and its client half on the desktop and in the terminal client.
It reaches Slack through the account service's Slack gateway ([the Slack gateway API](../account-api/slack-gateway.md)),
so the Node never holds a Slack token.

## How it fits together

```text
Slack ──events──► the Slack gateway, part of the account service
                    checks Slack's signature, picks the Node, keeps no message text
                    │ a relay ticket for the Node's owner, a `tls` stream, the pinned fingerprint
                    ▼
                  relay ──► Node: POST /v1/gateway/slack/events
                              plugins/slack ──► core tasks, agents sessions

Slack ◄──Web API── the gateway ◄──POST /slack/v1/calls── plugins/slack, signed in as the owner
```

The gateway answers Slack, finds the Node, and posts the event through the relay to the Node's
[gateway route](../authentication/gateway-routes.md). The plugin answers at once and does the work
after, in order. To answer, it asks the gateway to make a Slack call, through the account plugin's
`account.service` capability.

| Slack | Acorn |
| --- | --- |
| A workspace and one Slack user | A link to one Acorn account, and the one Node that account picked for Slack work |
| A channel or a DM | The owner's project and mode there, kept on their Node |
| A conversation channel or DM | One branchless task in the project folder, which all its threads share |
| A top-level message to @acorn in a tasks channel | A task with its own branch, and one agent session in it |
| A top-level message to @acorn in a conversation channel | An agent session in the channel's task |
| The thread under that message | The conversation with that session |
| A message from the owner | A turn in that session |
| A message from anyone else in the thread | Context on the owner's next turn, with who wrote it |

A thread belongs to the Node of the person who started it. A local Node has one owner, and only that
owner's Slack user starts or steers turns.

## Linking

**Settings → Slack** links your Slack user to this Node. It needs a sign-in on **Settings → Account**
and **Remote access** on, because the gateway reaches the Node through the relay. **Link Slack** asks
the gateway for an address that runs Sign in with Slack, which you open, and the page polls until the
link reaches the Node. The terminal client shows the address to open. When your Slack user is linked to
another of your Nodes, the page says where Slack work goes and offers **Link this Node instead**.

**Answer approvals from Slack** is unticked by default, beside this sentence: "If the hosted service
were broken into, whoever did it could send your agent a prompt and approve what it runs." The choice
is kept on the Node, so the gateway can't change it.

Until a link exists, the plugin makes no request and acts on no event. Its registration is all that
runs at boot. The rest loads on the first delivery, settings request, or agents event.

## Two modes

Each channel and DM has a mode, set with `/acorn mode`. A DM starts as a conversation, and a channel
starts as tasks:

- **Tasks.** Each top-level message is a task of its own, made with core's `createRoot` and titled with
  the message's first line. Its branch and worktree are made on first use. A repeated delivery finds
  the same task, because its ID derives from the message.
- **Conversation.** Each top-level message is a session in the channel's task: one task per channel and
  project, with no branch, in the project folder, titled after the channel or "Slack DM". When that task
  is archived, the next top-level message makes another.

Sessions in a conversation channel share the project folder, so two threads that edit files at once
edit the same checkout. Changing a channel's mode or project affects only threads started afterward.

`/acorn project <name>` sets the channel's project, matching names without case, an exact match before
a single prefix. With no project, the bot offers a picker, which can remember the pick. A message waits
15 minutes for it.

## Turns

The plugin runs each owner message through `agents.sessionExecute`, bound to itself the way the host
binds a loaded plugin's copy. So a Slack turn runs gated, a harness mode that skips its own permission
checks is refused, and the session list shows the session "by slack". The prompt is the owner's words.
The Slack rules, guests' replies, and a thread's earlier messages go in `context`, which the model reads
as information. Turns run one at a time per session, for up to four hours each.

Answers post from `plugin:agents:turn-changed` and `agents.reviewInput.v1`, not from the call's return
value, so a Slack turn, a turn typed in Acorn, and a turn a restart interrupted take one path. The first
event after a restart posts what turns that settled while the Node was down owe.

## Approvals

When an agent in a Slack session asks permission, a card in its thread shows the request's title and
detail, with known key values removed. With approvals from Slack on, it has **Approve** and **Deny**,
which answer the request's allow-once or reject-once option through `agents.requestAnswer`
([session control](../managed-agents/session-control.md#answering-a-request-from-a-plugin)). Only the
owner's click counts. Without approvals on, the card links to Acorn. Any other kind of request asks the
owner to answer in Acorn.

## Room for forks and several agents

The plugin keeps a thread's sessions as a list, and keys turns, status lines, answers, reactions, and
cards by session, never by task. The gateway knows threads only. So a fork into a second session, or a
second agent in one thread, can come later without a migration or a gateway change. The first version
writes one session per thread.

## Limits

- The task doesn't link to its Slack message. Task links need a provider connection, and the Node holds
  no Slack one.
- A known key's value can't be cut out of text by position, so text that holds one isn't posted. A post
  says so and points to Acorn. Anything that reads as a secret is cut out.
- Files and images aren't carried either way.
- The link to a task in a post is the phone app's `/t/<task ID>` on the account website.

## Why

The plugin is compiled because it needs three seams only compiled plugins get: a gateway route, root
task creation, and the account plugin's sign-in. As a loaded plugin, each would be a new grant in every
third-party trust prompt.
