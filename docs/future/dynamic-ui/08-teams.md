# Phase 8: apps on a team

Status: proposed, 2026-10-01. Revised 2026-10-19 for OpenUI Lang and plans. Depends on
[phase 5](./05-project-apps.md), and waits on
[cloud phase 9](../cloud/phases/09-teams.md), which brings roles and route classification. Nothing
here changes a local Node with no account.

## Goal

Teammates share project apps. Anyone on the project opens them, members edit and publish them, and
viewers only look. Each person's device draws a teammate's app with its own library, under its own
person's role.

## What a team gets at the end

- Project apps on the team Node, listed in every member's left rail for that project.
- Task apps in cloud tasks, published to the team Node like any other project app.
- Each app's data read under the viewing person's own role, never the author's.
- An admin switch that turns agent-built apps off for the team.

## Starting point

- Phases 1 to 5, and phase 6 if it has shipped.
- From the cloud programme: the team Node owns shared projects, a worker is a full Node for one task
  attempt whose data root is archived at teardown, and grants carry `admin`, `member`, or `viewer`
  ([cloud architecture](../cloud/architecture.md), [cloud identity](../cloud/identity.md)).

## Requirements

### Where apps live

1. Project apps for a shared project live on the team Node.
2. Task apps in a cloud task live on its worker, and the whole-root archive carries them like any other
   task data.
3. **Publish to project** from a worker sends the head revision to the team Node through a versioned
   contract. The team Node applies the same conflict rule as a local publish.

### What each device draws

4. No device prompts to trust an app, from a team Node or a worker, because a program runs no code.
5. Each device draws a program with its own library. A device on an older library drops the
   components it doesn't know and draws the rest, as OpenUI's error recovery does, and the card
   names the library version the program needs.
6. App cards and panes say which teammate's session built the revision.

### Roles

7. A viewer can open project apps and task apps they can read. Their row actions, compose calls, and
   state writes are refused, and the app shows that it is read only.
8. A member can edit, draft, publish, delete, and restore.
9. Every plan runs under the viewing person's grant, as dashboard panels do. An app never carries its
   author's access.
10. The app routes and tool calls declare `read` or `mutate`, as cloud phase 9 requires of every route
    and bridge verb.
11. Every revision and publish records the account that made it.

### Team policy

12. An admin setting, **Allow agent-built apps**, is on by default. Off, the app tools are absent from
    agent sessions on the team's Nodes, and existing apps show as disabled.

## Out of scope

- Real-time co-editing of one app by two people. Drafts and the conflict rule cover concurrent edits.
- Sharing apps between teams.

## Risks

A teammate's agent can put an app on your screen. The host's tools still bound what it can do, row
actions and links still need your confirm, and data still flows under your own role. The new risk is misleading UI, such
as a button labelled one thing that fires another row action. The host's risk confirm names the action
itself, not the app's label, which is what bounds it.

## Steps and checkpoints

**Checkpoint 1.** A member publishes an app from a cloud task. A second member sees it in the left rail
after the team Node acknowledges it, and opens it with no trust prompt.

**Checkpoint 2.** A viewer opens the same app. It renders read only. Calling the state write route with
the viewer's grant fails.

**Checkpoint 3.** An app over a data source the viewer cannot read shows the unavailable state for that
viewer and the data for a member.

**Checkpoint 4.** An admin turns **Allow agent-built apps** off. A new session has no app tools, and the
rail shows the apps as disabled.

## Docs that change

- [Security](../../security.md): apps on team Nodes and workers, under each viewer's role.
- The cloud programme's [plugins and secrets](../cloud/plugins-and-secrets.md) and
  [identity](../cloud/identity.md): the app routes, policy, and route classes.

## Verify before building

- Cloud phase 8's plugin policy, and whether **Allow agent-built apps** belongs in it.
- How a client learns the library version of the device that wrote a program, so a mismatch is named
  rather than guessed.
