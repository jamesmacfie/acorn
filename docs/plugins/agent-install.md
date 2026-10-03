# Agent installs and development mode

This page covers how an agent asks the owner to install a plugin, how development mode removes the
per-save trust prompt, and how acorn teaches an agent the plugin contract. It's part of the
[plugin reference](../plugins.md). The security reasoning is in
[installing plugins](../security/plugin-install.md).

## Approval-mediated install

The install route is device-gated, unreachable from a plugin frame, and audited. On top of it, an
agent's request can reach the owner's decision.

The `plugin_request` agent tool is core-owned and has the `execute` tier
([agent tools](../agent-tools.md)). It takes an action (`install`, `update`, or `uninstall`), a
source or plugin id, an optional `dev` flag, and one line of the agent's reasoning. It installs
nothing. `server/agentTools/pluginRequests.ts` imports `node:crypto`, `zod`, the tool registry, and
the protocol types, and a test asserts that exact list, so no installer is in reach. The handler
writes an in-memory row, broadcasts a content-free `workflow:notice`, and throws `needs-trust`. The
agent gets a 409 telling it to call again with the same arguments to collect the answer.

The owner sees the notice in the bell, which opens the approval dialog in the shell's overlay slot,
where a plugin frame can't draw. On approval, the device performs the install over the same
`/v1/core/plugins/*` routes **Installed** uses, with its own principal. The agent never holds a
credential that can install code.

Four properties:

- **The queue rides the roster.** `GET /v1/core/plugins` carries `requests`, so there's no second
  route to gate. `POST /v1/core/plugins/requests/:requestId` records the answer. It's device-only and
  can never be mapped from a frame (`client-core/host/frames/scopes.ts`).
- **One ask is one question.** Identical arguments resolve to the same pending row, and only the
  first one rings the bell. There can be at most 20 outstanding requests.
- **An approval is spent once.** Collecting the decision deletes the row.
- **The request store is in memory, and the code gate is durable.** An unanswered request expires
  after an hour or a Node restart. Once the owner fetches a package for review, a marker beside the
  installed directory keeps it inert across restarts until the owner approves or removes it. The
  marker is written before the package is placed and checked before every boot or reload import.

### What the owner can know before the download

The installer validates a manifest only after fetching and unpacking, so approval takes two screens:

1. **The ask.** The action, the source, the agent's reason, and the `dev` flag. This gates the fetch,
   because a Node reaching out to a URL an agent chose is a network action. No means nothing is
   downloaded.
2. **The review.** The device installs behind a durable pending-review marker, reads the real
   manifest back from the roster, and shows what the package declares. The loader refuses to import a
   marked package at boot or reload, and the client doesn't offer its bundle. Approval checks the
   marker generation and a fingerprint of the package tree before clearing the gate. No removes the
   package and the marker and keeps the plugin's data.

If the owner dismisses the review, the marker stays. The plugin's **Permissions** tab shows the held
package with approve and remove actions after a reconnect or restart, and the plugin is listed under
**Needs you**. A staged update can let the old process keep serving the previous version, and a
restart before approval never imports the replacement. Direct owner installs use the ordinary path
but can't replace a package that's held for review.

Downloading and validating first was rejected. It fetches on the agent's word, and pinning the
reviewed bytes would need either a staging directory that outlives the request or a second download
that can resolve to something else.

The client half also gets the per-hash bundle prompt on the next distribution pass. The review screen
adds the node half, which has no other disclosure before it starts at the next restart.

## Development mode

Per-hash trust is right for distribution and wrong for iteration, because an agent saving a file
every minute would cause a prompt per save. The owner makes one decision instead, by approving a
`dev: true` request, and the device stores a dev trust grant.

The grant lives in the device's trust file (`packages/custody/src/plugins/pluginTrustStore.ts`) as
`{ pluginId, nodeId, path?, grantedAt }`. It's keyed on the pair, so a bundle a different Node offers
under the same name isn't trusted.

When the helper caches a bundle for a plugin under a grant, it records an ordinary accepted
acknowledgement for those bytes beside the hash it computed. The renderer never queues a prompt, and
eligibility sees an ordinary acceptance. A row written this way is marked `dev: true`, so revocation
can find it, and `partial: true`, because nobody read a disclosure, so it never becomes the baseline
of a later "what changed" diff.

Development mode uses the local-path install, `{ path }`, so the agent has a folder to edit in place,
and a development install ends in a reload where the plugin can be reloaded.

The plugin's row says **In development. Bundle changes are trusted without asking**, and its
**Permissions** tab has **End dev mode**. Ending it removes the grant and every acknowledgement the
grant wrote. Decisions the owner made by hand survive, so with nothing left the current bundle is
undecided and the normal prompt asks on the next pass. Revoking and promoting out of development mode
are the same operation.

A packaged build allows the `{ path }` source too ([installing from a folder](../security/plugin-install.md#installing-from-a-folder)).
The grant isn't gated on packaging. Over a remotely sourced plugin it means only that later versions
don't prompt again, and each iteration is still an explicit update.

## Teaching the agent

An agent that guesses at the manifest spends its first session finding out that `zod` won't resolve
and that a second client module answers 404. So the Node that enforces the contract serves it, through
two doors onto one text (`server/agentTools/pluginAuthoring.ts`):

- The `plugin_authoring` tool takes no arguments and has the `read` tier. Every list in its answer is
  derived at call time from the schema that enforces it ([agent tools](../agent-tools.md)).
- The `plugin-authoring` context section is `defaultIncluded: false`, so a task that isn't writing a
  plugin never assembles it.

The process half is prose: write the folder, ask with
`plugin_request { action: 'install', source: { path }, dev: true }`, expect `needs-trust`, call again
with the same arguments to collect the answer, then iterate with `action: 'update'` and `dev: true`,
so approval ends in a reload.

**Settings > Plugins > Installed > Create a plugin** drafts that starting prompt into the current
task's agent composer through `sendReferenceToAgent`, the seam the editor and Changes panes use. It's
a draft, not a send. It doesn't open a new task, because `TaskSeed` has no prompt field and Settings
has no project in scope.
