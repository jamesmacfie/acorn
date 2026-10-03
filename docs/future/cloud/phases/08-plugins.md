# Phase 8: plugins in cloud tasks

Status: proposed, 2026-09-29.

## Goal

Let a team admin approve loaded plugins by exact hash, let a project add or disable approved
plugins, freeze the effective set per attempt, and give each plugin the cloud connections and
settings it needs. A worker runs exactly the locked set, and a device still trusts each client bundle
itself.

Read [plugins and secrets](../plugins-and-secrets.md) before starting.

## What you can deploy at the end

On staging and for the closed alpha, a team admin approves a loaded plugin such as Linear, sets up
its cloud connection, and cloud tasks in the team's projects show its panes. An unapproved or
misconfigured plugin blocks launch with a reason before any spend.

## Starting point

- Hardened workers from [phase 7](./07-isolation.md).
- The installer, with hash-pinned installs from GitHub, npm, and tarballs, in
  `packages/node-core/src/server/plugins/installer.ts`.
- The approval-mediated install review in [plugin activation](../../../plugins/agent-install.md#approval-mediated-install).
- Per-device trust of client bundles by plugin ID and hash.

## In scope

- Where plugin policy and cloud connections are authored.
- The team baseline and project overrides.
- The frozen plugin lock at reservation, shown before launch.
- A package cache by hash for workers.
- Cloud connections per plugin, readiness checks, and a declared provisioning step.
- Offering a locally installed plugin for team approval.

## Out of scope

A public plugin catalog. Folder installs and development grants on workers.

## Steps and checkpoints

### 1. Decide where admins author policy

The earlier draft said both "the web app administers plugin policy" and "the team Node owns plugin
policy". Those conflict, because the web app never talks to a Node. Settle it before building. See
the first open question.

### 2. Approve a package

An admin submits a package source. The team Node fetches it, validates the manifest, and shows its
declared permissions and Node grants, reusing the review screens from approval-mediated install. The
admin approves the exact hash and grants.

**Checkpoint 1: approval shows what you approve.** Submit a GitHub-release plugin. The review lists
its hash, permissions, and grants. Approve it. The team baseline lists it.

### 3. Project overrides and the lock

A project can disable a baseline plugin, add an approved one, or pin another approved version. At
reservation, the team Node freezes the lock with a digest.

**Checkpoint 2: the lock is visible and exact.** In the new-task flow, the lock lists every plugin
and version. After launch, the worker's roster matches the lock exactly.

**Checkpoint 3: blocked is blocked.** Add a plugin to a project whose approved version is missing
from the cache and unreachable. Launch refuses with the plugin ID and reason, before provisioning.

### 4. Cloud connections

Admins create cloud connections on the team Node. The seed carries only the connections the lock
needs. A plugin either works with those settings or declares a provisioning step.

**Checkpoint 4: missing configuration is caught early.** Approve Linear without a cloud connection.
The new-task flow names the missing connection and does not start a worker. Add the connection. The
next cloud task shows Linear panes with the team's data.

### 5. Client trust per device

**Checkpoint 5: one trust decision per hash per device.** Open a cloud task with a newly approved
plugin. The desktop asks to trust its client bundle once. A second cloud task with the same hash, and
a restore Node, do not ask again. A second device asks for itself.

### 6. Offer from local

A member offers a plugin installed on their local Node for team approval. Only the source and hash
move.

**Checkpoint 6: nothing private moves.** Offer a plugin with a local connection and local data. The
team Node receives the source and hash only. No credential, preference, or database row from the
local Node appears on the team Node.

## Acceptance

- Workers run exactly the frozen lock, verified by comparing the roster with the lock digest.
- An unapproved, missing, or unconfigured plugin blocks launch with its reason before spend.
- Team approval never trusts a client bundle on a device.

## Docs to update when it ships

- [plugin activation](../../../plugins/activation.md): project policy and locks on hosted Nodes.
- [security](../../../security.md): team approval and its limits.

## Open questions

1. Where do admins author plugin policy, team policy, cloud connections, and secrets? Options:
   - In desktop and TUI Settings, against the team Node, with an `admin` grant. Simple, keeps
     secrets off the control plane, and keeps the web app free of Node traffic. Recommended for
     connections and secrets.
   - In the web app, stored in the account service as metadata, then pushed to the team Node. Package
     IDs, hashes, and grants are not task content, so this fits the three-party rule for the
     baseline, but project names would have to be shown by opaque ID or copied to the control plane.
   - Both: the baseline in the web app, project overrides and connections in the clients.
2. Where is the package cache: on the team Node's volume, or in the regional bucket?
3. Can a plugin declare itself unsuitable for cloud workers, for example because it needs Docker or
   a display?
4. How does a team update an approved plugin? Re-approval of the new hash, with a diff of
   permissions?
5. What happens to plugin data from an old attempt when a new attempt runs a newer version whose
   migrations have moved on?
6. Does the team Node itself run the approved plugins, or only workers? Some plugins, such as Linear,
   are useful for browsing on the team Node too.

## Evidence

Record approval and lock behavior findings here, with dates.

## Verify before building

Check how the installer records hashes for each source kind, and which plugins read their
connections at `init`.
