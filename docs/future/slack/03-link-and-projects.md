# Phase 3: linking and projects

Date: November 19, 2026. Status: proposed. Depends on phases 1 and 2.

## Goal

A person links their Slack user to this Node from **Settings → Slack**, and chooses whether to answer
approvals from Slack. They set a project and a mode per channel with `/acorn project` and
`/acorn mode` ([two modes](./rules.md#two-modes)). When a message arrives with no project, the bot
offers a project picker.

## Starting point

- The account plugin, `plugins/account`, is the compiled plugin to copy. Its node half is registered
  in `apps/node/src/composition/plugins.ts`, and its client half in `apps/desktop/src/client/plugins.ts`
  and `apps/tui/src/roster.ts`. Its settings page draws on the desktop and in the terminal client.
- Phase 2's `ctx.routes.gateway` and `account.service`.
- `ProjectService` on `ctx.core.projects` lists the Node's projects.

## In scope

- `plugins/slack`, compiled, with node, client, and contract halves.
- Its database: links, the approvals choice, channel settings, threads, messages, pending picks, and
  turns. Phase 4 fills threads, messages, and turns.
- **Settings → Slack**, `/acorn`, and the project picker.

## Out of scope

Tasks and turns, which are phase 4. Approvals, which are phase 5.

## Steps

1. Create `plugins/slack` in the account plugin's shape. Register its node half with the compiled
   plugins and its client half on both clients.
2. Load on first use. At start, the plugin registers its gateway route and its event listeners and
   nothing else. Each handler imports its code on its first call, and returns at once while no link
   exists.
3. Add migrations for these tables:

   | Table | Holds |
   | --- | --- |
   | Links | Team, Slack user, Slack name, and whether approvals from Slack are on |
   | Channels | Team, channel, whether it's a DM, project ID, and mode |
   | Channel tasks | Team, channel, project ID, and the conversation-mode task for them |
   | Threads | Team, channel, thread timestamp, task ID, and whether the thread has ended |
   | Thread sessions | Thread, session ID, and the order sessions joined it. The first version writes one per thread. |
   | Messages | Team, channel, timestamp, thread timestamp, sender, text, owner or guest, and the turn it went into |
   | Pending | A message waiting on a project pick, with an expiry |
   | Turns | Turn ID, its thread and starting message, the status message's timestamp, the reaction shown, and whether its answer posted |

   Message text stays on the Node, which owns it. Delete a thread's rows when its task is deleted.
   Threads hold sessions as a list, so a fork or a second agent can join a thread later without a
   migration ([room for forks and several agents](./README.md#room-for-forks-and-several-agents)).
4. Draw **Settings → Slack**, one state at a time:
   - Not signed in: a line that points to **Settings → Account**.
   - **Remote access** off: a line that says Slack needs it, with a link to turn it on.
   - Not linked: **Link Slack**, with the **Answer approvals from Slack** box unticked and the
     sentence "If the hosted service were broken into, whoever did it could send your agent a prompt
     and approve what it runs." Linking calls `POST /slack/v1/links`, opens the address, and polls
     `GET /slack/v1/links` until the link appears.
   - Linked to another Node: "Slack work goes to Mac Studio", with **Link this Node instead**.
   - Linked here: the workspace, the Slack name, the approvals switch, and **Unlink**.

   The terminal client prints the address instead of opening it.
5. Handle `/acorn`, for the owner only:
   - `/acorn project <name>` matches the Node's projects by name, ignoring case, exact match before
     prefix. It sets the default for that channel or DM, and answers with an ephemeral note.
   - `/acorn project` with no name answers with the picker.
   - `/acorn mode tasks` and `/acorn mode conversation` set the mode for that channel or DM. With no
     argument, it answers with the current mode and what each one does.
   - `/acorn help` answers with a short ephemeral help text.

   A channel with no row uses its default: conversation for a DM, tasks for a channel. A change
   affects only threads started afterward.

   Anyone else gets "Only James can use this Node from Slack."
6. Offer the picker when the owner's message needs a project and the channel has none. Keep the
   message in the pending table for 15 minutes, and send an ephemeral `static_select` of projects,
   with **Remember for this channel** ticked. A pick sets the default when asked, replaces the
   picker through `respond` with "Started in billing-api", and hands the message to phase 4. An
   expired pick replaces the picker with "This expired. Mention @acorn again."

## Verify before building

- Whether an ephemeral message can carry a `static_select`, and how many options it allows. With
  more projects than that, offer the most recently used ones and `/acorn project <name>`.
- How the terminal client draws a settings page that waits on a browser sign-in, the way
  **Settings → Account** does.
- The Node service size the registration adds.

## Tests

- Each settings state, with the stand-in's links.
- `/acorn project` matching: exact, prefix, two prefixes, none, and a project with no folder.
- `/acorn mode`: each value, no value, and the defaults for a DM and a channel.
- A non-owner's `/acorn`.
- The picker: a pick, **Remember** unticked, expiry, and two pending messages in one channel.
- No request and no handler work before a link exists.

## Checkpoint

In `pnpm dev:agent` with `pnpm dev:account`, link a fake Slack user from **Settings → Slack**, run
`/acorn project` and `/acorn mode` through the stand-in, and check the fake Slack's recorded calls. Unlink, and check
that a mention gets the gateway's link note. Record the date and the result here.
