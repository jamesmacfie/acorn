# Phone devices

This page covers the device a phone gets when it pairs, what that device may do on a Node, and shell
access, the grant that lets one phone run commands. It's part of [the phone channel](../phone-channel.md).
Read it before you change the phone rules (`packages/node-core/src/server/middleware/phoneRules.ts`), a
plugin's phone writes, or how a phone may drive an agent.

## A device for each phone

A phone pairs by approval, as a laptop does ([pairing by approval](../../api-reference/transport.md#pairing-by-approval)):
it asks with an account assertion, a paired device shows the same three words, and **Allow** hands the
phone a token. The first phone pairs at home, approved on the Node's own computer.

A device paired through a channel is marked `kind: "phone"`, whatever it calls itself, because the Node
knows which door it came through. The phone keeps its token in IndexedDB, encrypted with AES-GCM under a
key the browser made and won't hand over, so a copy of the browser's storage holds ciphertext. That
doesn't protect against script running in the app. A phone names itself from its browser and a short
random tag, such as "iPhone Safari 1a2b", so the device list and the audit log tell phones apart.

## What a phone device may do

The phone app runs on the account website's origin, and the phone keeps its device token where any script
on that origin can use it. So whoever can change what the account website serves can act as the phone:
its operator, someone who breached its hosting or build, or a change in one of its dependencies. So can
someone holding the phone unlocked. The Node holds a phone to its screens, in two lists in
`server/middleware/phoneRules.ts`, and a test pins both. A refused request gets `403 phone_refused`.

No phone may call these routes:

- Opening a pairing window, and everything under `/v1/core/devices`. Answering a pairing request is
  allowed, and the device a phone allows is held as a phone too ([below](#a-device-a-phone-approved)).
- Every `POST`, `PUT`, `PATCH`, or `DELETE` under `/v1/core/plugins`, so a plugin write added later is
  refused too.
- Backup and restore, security settings, `PUT /v1/core/node/reach`, and `POST /v1/core/node/stop`.
- Every write under `/v1/core/integrations`, and every write under a plugin mount registered with
  `phone: 'refused'`. The account plugin's sign-in, sign-out, remote access, phone previews, and relay
  tickets, and the Slack plugin's links and approvals, are refused this way. They decide who else can
  reach the Node, and a Slack link would outlive the phone. A phone can still read them.

Until a computer gives it [shell access](#shell-access), a phone may also only:

- Read. Every `GET` and `HEAD` is open, except through a loopback route such as a task's preview proxy,
  which reaches the task's app on the Node's own loopback.
- Write what the phone's panes write that can't run a program on the Node. Core's writes are in
  `PHONE_ALLOWED`: answering a pairing request, making a task and editing its title and links, and data
  sources, queries, and dashboards. A built-in plugin names its own in the `phone` option of
  `ctx.routes.register` or `ctx.routes.fetch`, as a method and a path under its mount, such as
  `'POST /sessions/:sessionId/turns'`. The built-in plugins name agent sessions, under the rules below,
  and Git: staging, committing, pushing, and pulling, without a project's settings. They also name
  GitHub, GitLab, and Bitbucket actions, notes, memory, opening a preview, and stopping a workflow run.
  The host drops `phone` from a loaded plugin, so a loaded plugin's writes need shell access.

Everything else needs shell access, including any route added later. That leaves out terminals and their
input, run targets, task setup and teardown scripts (so making a task runs no setup, and archiving or
restoring one needs shell access), and config trust. It also leaves out project, workspace, preference,
schedule, and node provider writes. And it leaves out file edits, Docker actions,
workflow definitions, gates, and retries, agent tools, MCP servers, and custom agents. Every loaded
plugin's writes need it too, so the Database, API, Linear, and Rollbar panes are read-only on a phone
without it.

The event feed holds a phone the same way. Without shell access it may watch a terminal's output and a
container's logs and stats, and the Node drops every other frame it sends. That includes terminal
input and the editor's, memory's, and Docker's own terminals.

**Agents.** A phone without shell access drives an agent only while a person approves each of the
agent's commands. That's Claude Code's `default`, `plan`, or `dontAsk` mode, rank 0 in
`plugins/agents/src/server/sessions/executionPolicy.ts`. The rules live in
`plugins/agents/src/server/sessions/phoneTurns.ts`:

- A turn the phone sends is marked. Before the agent gets it, the Node reads the session's mode again,
  and it fails the turn when the mode runs anything without asking. Steering a marked turn into a running
  one is checked the same way. Codex has no such mode, so a phone without shell access can't drive it.
- The phone can't approve a permission request or a workflow gate, because approving runs the command.
  It can answer a question only in a session that asks before each command.
- The phone can't set a mode, now or for the next start, that runs anything without asking. It can't
  rewrite a queued message.

A phone's device that nobody uses for 30 days is revoked the next time it asks. Revoke one phone from
**Settings → Nodes** on a computer, which lists each device. The others keep working. Signing out of the
account revokes every phone, because none can reach the Node without it. Turning remote access off
alone keeps them.

## A device a phone approved

A phone may answer a pairing request, so it can let a laptop in when the phone is the only device
online. The device it allows is marked `kind: "phone"`, whatever connection collects the token, and gets
a phone's limits and no shell access. Otherwise script in the phone app could raise an ask with the
account session, allow it with the phone's own token, and collect a full device somewhere else that
outlives revoking the phone. To give such a laptop full authority, revoke it from a computer and pair it
again there.

## Shell access

Shell access is a grant for one phone, apart from pairing it. Only a computer gives it, from
**Settings → Nodes**, because no phone may reach `/v1/core/devices`. The button asks for a second press
and says what the grant risks. The Node records when it was given in `devices.shell_access_at`, audits
`device.shell.granted` and `device.shell.revoked`, and closes the phone's event feed so it reconnects
under the new grant.

```text
PUT /v1/core/devices/:id/shell-access        { "granted": true }
204, or 404 for a device that isn't a live phone
```

A phone with shell access may do everything a computer may, except what the first list above refuses
every phone. **Giving one shell access means that a breach of the account website, or the phone
unlocked in someone else's hands, can run commands on this Node.** That includes anything the phone's
device can reach, such as the `acorn` CLI's own device token. Give it only to a phone you'd trust with a
terminal on this computer, and take it away when you're done.
