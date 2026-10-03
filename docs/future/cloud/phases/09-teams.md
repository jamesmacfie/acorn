# Phase 9: teams and roles

Status: proposed, 2026-09-29.

## Goal

Let more than one person use a team. Invite members, give each a role, enforce the role on every
route, stream, plugin bridge, and approval on every hosted Node, and take access away in seconds.

Read [identity](../identity.md#roles-and-route-classification) before starting. The hard part of
this phase is not invitations. It is classifying every route in core and every plugin so a viewer
truly cannot mutate.

## What you can deploy at the end

A closed beta, free of charge. Real teams with several members invite each other, share projects,
watch each other's cloud tasks, and answer each other's agents. Viewers read without changing
anything. Admins remove people, and removed people lose access at once.

## Starting point

- Single-person teams with hardened workers and plugins from [phase 8](./08-plugins.md).
- Grants that carry a role, with only `admin` accepted, from [phase 3](./03-team-node.md).
- The mount coverage test in `packages/node-core/src/server/mountCoverage.test.ts`.

## In scope

- Invitations by email, accepting, leaving, and removing.
- Roles `admin`, `member`, and `viewer` in the web app.
- Classification of every core route, plugin route, plugin action, WebSocket subscription, stream,
  and frame bridge verb as `read`, `mutate`, or `admin`.
- Enforcement on every hosted Node for `member` principals.
- The five-minute outage rule.
- Notifications routed by role.
- The team audit views.

## Out of scope

Per-project roles. Single sign-on. GitHub organization sync.

## Related work

[Team memory](../memory.md) depends on this phase's roles and route classification. It specifies
shared project memory, private memory per account, worker seeds and write forwarding, attribution,
and optional approval, with its own delivery checkpoints.

## Steps and checkpoints

### 1. Invitations

Set up the email provider. An admin invites by email with a role. The invitee signs in with GitHub
and accepts. The account service records the membership and bumps the membership version.

**Checkpoint 1: invite and join.** Invite a second account as a member. They accept, sign in from
desktop, and see the team Node and its shared projects in the rail.

### 2. Classify every route

Extend the mount coverage test so every core route must declare its class. Add the declaration to the
plugin registration API and to the manifest for loaded plugins. Audit every first-party plugin's
routes and actions. Deny an unclassified plugin action to viewers by default.

**Checkpoint 2: the build fails on an unclassified route.** Add a core route with no class. The test
fails.

### 3. Enforce

Check the class for every `member` principal on HTTP routes, WebSocket subscriptions, stream
attaches, plugin bridges, agent approvals, elicitation answers, and gate approvals.

**Checkpoint 3: a viewer cannot write, even by hand.** As a viewer, in the UI, confirm there is no
way to edit a note, start a terminal, send an agent message, answer an approval, or start a cloud
task. Then, with the viewer's grant and `curl` through the relay, try each of those routes directly.
Each returns 403.

**Checkpoint 4: a viewer can read.** As a viewer, open a running cloud task. The transcript streams
live, the diff shows, and the terminal is visible but refuses input.

### 4. Revocation and the outage rule

**Checkpoint 5: removal is immediate.** While a member has a terminal and an agent stream open,
remove them. Both close within seconds. Their next grant request fails.

**Checkpoint 6: a role change applies live.** Change a member to viewer while they are connected.
Their mutating actions disappear on the next refetch, and the Node refuses mutations at once.

**Checkpoint 7: the outage rule.** Stop the account service. Connected members keep working for up to
five minutes after their last verified membership. After that, the Node refuses them. New sign-in
and provisioning fail at once. Restore the account service. A removal made during the outage takes
effect when it reconnects, and the audit trail records the delay.

### 5. Notifications and audit

Route agent questions and approvals to members and admins, not viewers. Add team audit views: the
account service's membership history in the web app, and the team Node's grant and mutation history
in the clients for admins.

## Acceptance

- Every core and first-party plugin route is classified, and the test enforces it.
- Viewers cannot mutate through any path, checked by direct API calls.
- Removal closes live connections within seconds.
- The outage rule behaves as described and the UI says so.

## Docs to update when it ships

- [authentication](../../../authentication.md): roles and their enforcement.
- [security](../../../security.md): role enforcement and the outage rule.
- The plugin authoring documentation: the route class declaration.

## Open questions

1. Invite by email only, or also by GitHub username?
2. Can members publish projects, or only admins?
3. Who can approve an agent's request in a shared task: any member, or only the person who started
   it?
4. What happens to a departed member's running cloud tasks: keep running, stop, or transfer?
5. How is team ownership transferred, and can a team have zero admins?
6. How long is audit history kept, and who can export it?
7. Does a viewer seat cost the same as a member seat?
8. Does a loaded plugin that predates the class declaration still load on a hosted Node, with every
   action treated as member-only?

## Evidence

Record the route audit's findings, including any plugin action that mutated through a read-shaped
route, here with dates.

## Verify before building

Check every `requireDevice` and `requireUser` mount, every plugin route registration, and every
frame bridge scope in `packages/client-core/src/host/frames/scopes.ts`.
