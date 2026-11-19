# Slack for Acorn agents

Date: November 19, 2026. Status: proposed. No phase started. The hosted service's Slack app and a test
sandbox were set up on November 19, 2026, and the hosted service's own docs record their details.

## What this is

Mention @acorn in a Slack channel, or send it a DM, and an agent starts work on your own Node. The
agent's progress, its permission requests, and its answers come back to the same Slack thread. You
approve from Slack, the desktop, or the phone app.

Each channel and DM works in one of two modes, which the owner sets with `/acorn mode`:

- **Tasks.** Each top-level message is a task of its own, with a branch, a worktree, and one agent
  session. This suits a channel for implementation work. Channels start in this mode.
- **Conversation.** Each top-level message is a new agent session in one task the channel shares,
  in the project folder. This suits a DM with the bot, where one person has many separate
  conversations about one project. DMs start in this mode.

Here is one run in a tasks channel, start to finish:

1. In #billing, James writes "@acorn the webhook retries double-charge, fix it".
2. 👀 appears on his message. His Node, a Mac Studio at home, has it.
3. A task opens in `billing-api`, James's default project for #billing, and ⏳ replaces 👀.
4. A status line in the thread reads "Working: Command, 3m".
5. The agent asks to run `pnpm test`. A card in the thread shows the command with **Approve** and
   **Deny**, and James taps **Approve**.
6. Alice replies in the thread: "the backoff is in deliver.py too". Nothing answers her. Her words
   reach the agent as context with James's next message.
7. The answer posts as a new message with the branch and the pull request link. ✅ replaces ⏳.
8. That evening, James opens the task on his laptop and asks a follow-up in the composer. His
   question and the answer appear in the thread, marked as sent from Acorn.

In his DM with the bot, James asks "where do we compute VAT?" and, later, "why is the invoice test
slow?". Each question starts its own session in the DM's task for `billing-api`, called "Slack DM".
Each thread is a separate conversation, and none of them makes a branch.

The design learns from the rough.app orchestrator, an always-on Claude Code session that takes work
from a Slack channel. [Research](./research.md) covers what it does, what Acorn takes from it, and
the Slack platform facts the phases rely on. [The conversation rules](./rules.md) say when the bot
acts, when it stays quiet, and what it posts.

## How Slack maps onto Acorn

| Slack | Acorn |
| --- | --- |
| A workspace and one Slack user | A link to one Acorn account, and the one Node that account picked for Slack work |
| A channel or a DM | The owner's project and mode there, set with `/acorn project` and `/acorn mode` and kept on their Node |
| A conversation channel or DM | One task without a branch, in the project folder, that all its threads share |
| A top-level message to @acorn in a tasks channel | A new task with its own branch, and one agent session in it |
| A top-level message to @acorn in a conversation channel | A new agent session in the channel's task |
| The thread under that message | The conversation with that session |
| A message from the owner | A turn in that session |
| A message from anyone else in the thread | Context on the owner's next turn, with who wrote it |
| The bot's reactions | The state of the turn that message started |
| Buttons | Approvals and project picks |

A thread belongs to one Node: the Node of the person who started it. A local Node has one owner, and
only that owner's Slack user starts or steers turns. Several people sharing one Node is cloud work
([teams and roles](../cloud/07-teams.md)).

## How it fits together

```text
Slack ──events──► hosted gateway, part of the account service
                    checks Slack's signature, picks the Node, keeps no message text
                    │ a relay ticket for the Node's owner, a `tls` stream, the pinned fingerprint
                    ▼
                  relay, unchanged ──► Node: POST /v1/gateway/slack/events
                                         plugins/slack ──► core tasks, agents sessions

Slack ◄──Web API── hosted gateway ◄──POST /slack/v1/calls── plugins/slack
                    holds the bot token     through the account plugin's sign-in
```

Slack posts each event to the gateway. The gateway answers Slack within 3 seconds, finds the Node,
and posts the event to it through the relay. On the way back, the plugin asks the gateway to make a
Slack call, such as posting a message, and the gateway makes it with the workspace's bot token. The
Node never holds a Slack token.

## Decisions James made on November 19, 2026

| Question | Answer |
| --- | --- |
| Slack app | One shared Acorn app per workspace, installed with **Add to Slack**. A hosted gateway receives Slack's events and holds the bot token. It reads messages as they pass and stores none. |
| Who drives a Node | Only the owner's linked Slack user. Other people's replies reach the agent as context. A list of other people the owner trusts comes later. |
| What a mention becomes | It depends on the channel's mode. In tasks mode, a new task per thread, with a branch and a worktree made on first use. In conversation mode, a new session per thread, in one task per channel. |
| Conversation mode's task | One task per channel and project, without a branch, titled after the channel. Not the project's **Keep in rail** task. |
| Default mode | DMs are conversations. Channels are tasks. |
| Forks and several agents in one thread | Not in the first version, but nothing in it may rule them out. See [room for forks and several agents](#room-for-forks-and-several-agents). |
| Approvals | **Approve** and **Deny** buttons in Slack, honoured only for the owner. |
| Reactions | The bot's status reactions only: 👀 received, ⏳ working, ✋ waiting for you, ✅ done, ❌ failed. |
| Project choice | `/acorn project <name>` sets the owner's default for a channel or DM, kept on their Node. With no default, the bot offers a project picker first. |
| Mirroring | Everything. Turns typed in Acorn, and their answers, also post to the thread. |
| Watching | The bot acts only on a mention, a DM, a reply in its own thread, a button, or `/acorn`. |
| Progress | One status message per turn, edited in place, then the answer as a new message. |
| Node offline | The sender gets a note only they can see, and the message is dropped. |

## Decisions in this plan

**The plugin is compiled into the Node, as `plugins/slack`, like the account plugin.** It needs three
things only compiled plugins get: `createRoot` on the compiled task service to make a task,
`knownValues.matcher` to remove this machine's keys from outgoing text, and the account plugin's
sign-in to call the hosted service. As a loaded plugin it would need four new grants, each one more
sentence in every third-party trust prompt. The cost is size: a loaded bundle adds nothing to the
Node service bundle, and a compiled plugin does. Everything except registration loads on first use,
and phase 6 asks James to raise the size ceiling by what's left.

**The gateway reaches the Node through the relay, and the relay doesn't change.** The gateway is part
of the account service, which signs relay tickets already. It opens an ordinary `tls` stream, pins
the fingerprint the Node registered, and calls one route with a short-lived token of a new type. A
second socket from each Node to the gateway would also work, but it duplicates the relay tunnel.

**Slack turns run through `agents.sessionExecute`, gated.** The owner's words are the prompt. Guest
messages and the Slack rules go in `context`, which the model reads as information, not
instructions. Answers post from the `plugin:agents:turn-changed` event and `agents.reviewInput.v1`,
not from the call's return value. One path then covers Slack turns, turns typed in Acorn, and a Node
that restarted mid-turn.

**Answering approvals from Slack is the owner's choice when they link.** Remote access promises that a
breach of the hosted service can't open someone's machine. Approval buttons break that for a linked
Node: whoever controls the gateway could send the agent a prompt and approve what it runs. So the
link screen has an **Answer approvals from Slack** box, unticked, with that sentence beside it.
Unticked, the approval card links to Acorn instead of showing buttons.

## Room for forks and several agents

James wants, later, to fork a Slack conversation into a second agent session, and to have more than
one agent answer in a single thread on one task. The first version builds neither, and keeps four
things true so that either can come without a rewrite:

- **A thread maps to sessions, not to a task.** The plugin's tables store a thread's sessions as a
  list. The first version writes one. Conversation mode already needs one task to hold many threads.
- **Everything is keyed by session.** Turns, the status line, answers, reactions, and approval cards
  belong to a session, never to a thread or a task alone. A second session in a thread then posts
  beside the first instead of over it.
- **A post names its session when a thread has more than one.** "Acorn · James · Codex" tells two
  agents apart, and the gateway's `username` field already carries it.
- **The gateway knows threads only.** Its grants name a thread and a Node. Forks and extra sessions are
  the Node's business, so neither needs a gateway change.

A fork would most likely start a new thread in the same channel, with a session forked from the
original through the agents plugin's fork route, and a first message linking back. That is a
proposal for the later phase, not a decision.

## Rules no phase may break

| Rule | Why |
| --- | --- |
| Until someone links Slack, the plugin makes no request and acts on no event. | A Node with no account behaves as it does without this plan ([remote access](../remote-access/README.md#rules-no-phase-may-break)). |
| The gateway stores IDs, never content: installs, links, and thread grants. No message text, answers, commands, or files. | The account service stores no task content. |
| Only the owner's linked Slack user starts turns or answers approvals. The Node checks, whatever the gateway checked. | A local Node has one owner, and every turn spends that owner's usage. |
| Slack turns always run gated, and a mode that skips the harness's own checks is refused. | Nobody watches a Slack-started turn the way they watch the composer. |
| Text leaves the Node only after this machine's known key values are removed from it. | A channel has an audience, and Slack keeps what it's sent. |
| The status line shows activity titles only, so a command reads "Command". An approval card shows the command, with keys removed, because nobody can approve what they can't read. | The same line the [activity frames](../../managed-agents/session-events.md#activity) hold. |
| A gateway token is accepted only on `/v1/gateway/*`, only through the relay, once, within 60 seconds. | It's a new way into a Node, so it gets the narrowest door. |
| `/v1` routes, `acorn-1`, and the account API v1 change only by addition. | Older clients and Nodes keep working ([versioning](../../api-reference/versioning.md)). |

## The phases

| Phase | What it delivers | Depends on |
| --- | --- | --- |
| [1. Gateway contract](./01-gateway-contract.md) | The Slack gateway API v1: routes, routing, the gateway token, what's stored, the schema, and a stand-in with a fake Slack | Nothing |
| [2. Node delivery](./02-node-delivery.md) | Gateway tokens and `/v1/gateway/<plugin>` routes in core, and `account.service` for calling the hosted service | Phase 1 for the token |
| [3. Link and projects](./03-link-and-projects.md) | `plugins/slack`, **Settings → Slack**, linking, `/acorn project` and `/acorn mode`, and the project picker | Phases 1 and 2 |
| [4. Threads to tasks](./04-threads-to-tasks.md) | Tasks and sessions in both modes, turns, guests, reactions, the status line, answers, mirroring, and restarts | Phase 3 |
| [5. Approvals](./05-approvals.md) | `agents.requestAnswer`, the approval card, and its buttons | Phase 4 |
| [6. Acceptance](./06-acceptance.md) | A walk in `pnpm dev:agent` with the stand-in, a live run in a real workspace, and the size ceiling | Phases 1 to 5, and the hosted gateway for the live run |

The hosted gateway is built in the hosted service's own repository, against phase 1's contract, the
way remote access plans its hosted steps ([where the code lives](../remote-access/README.md#where-the-code-lives)).
Phases 2 to 5 run against the stand-in and don't wait for it.

## Owning documents to update

| Contract | Owning page |
| --- | --- |
| The Slack gateway API | `docs/account-api/slack-gateway.md` (new), linked from [the account API](../../account-api.md), with its schema |
| The gateway token | [The account API § Signed tokens](../../account-api.md#signed-tokens) |
| `/v1/gateway/<plugin>` routes | [Authentication](../../authentication.md) and [the plugin API](../../plugins/plugin-api.md) |
| What a breached hosted service could do | [Control plane security § The account service](../../security/control-plane.md#the-account-service) |
| The approvals exception to remote access | [Remote access § Rules no phase may break](../remote-access/README.md#rules-no-phase-may-break) |
| `agents.requestAnswer` | [Session control](../../managed-agents/session-control.md) |
| The Slack plugin | `docs/integrations/slack.md` (new), listed in [integrations](../../integrations.md) |

## Rules for the work

- Run `pnpm lint` and the tests for each package you touch, and `pnpm test` before a phase is done.
- Open-side tests run against the stand-in, never the hosted service.
- Settle each phase's **Verify before building** items before writing its code, and record the
  answers in the phase file with the date.
- Each phase ends with a checkpoint someone runs by hand and records, with the date. A skipped
  checkpoint is written down as skipped, with the reason.
- Measure the Node service size after each phase. James approved on November 19, 2026 raising the
  ceiling by whatever this work adds, so don't ask him. The coordinating session raises it, because
  auto mode refuses an agent's edit to the ceiling as a way around CI. An agent working on a phase
  reports its growth in bytes instead. Give the old size, the new size, and the reason in the commit
  message that raises it.
- Batch the jobs that need James. Some steps can't run without him: work in Slack's website, a
  Slack CLI challenge code, an approval to push or tag, a command auto mode refuses, or a second
  account. Before a stretch of work, list every such job it needs, ask for them all in one numbered
  message, and carry on with what doesn't wait on them. Ask again only for something nobody could
  have foreseen.
- Pushes that deploy production and release tags still need James's go-ahead each time.
- When a phase lands, describe what shipped in its owning page and cut the phase file down to
  what's left.
