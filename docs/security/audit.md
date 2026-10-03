# Audit

This page covers the Node's audit trail: what it records, how a plugin adds verbs to it, and what it
deliberately leaves out. It also covers on-disk permissions and backups. It's part of the
[security model](../security.md).

## The trail

The append-only core `audit` table keeps security-relevant decisions for 90 days
(`packages/node-core/src/server/audit.ts`). The `core:audit-prune` schedule removes older rows. Core
records:

- pairing windows opened and closed, and devices paired and revoked;
- config-trust acknowledgements;
- secrets created, replaced, and deleted;
- plugin toggles, installs, updates, uninstalls, reloads, and review decisions;
- the owner's answer to an agent's plugin request;
- backups;
- attaching to and detaching from a control plane.

Settings → Audit log reads it through `GET /v1/core/audit`, which is device-only. The trail isn't
tamper-evident against someone who already controls the database file.

## The vocabulary is closed, and a plugin can add to it

Core's 18 verbs are a closed union in `server/audit.ts`. The settings page groups and filters on it,
and an action nobody can enumerate is one nobody reviews. A plugin declares its own verbs in its
manifest's `contributions.auditActions` or through `ctx.audit.declare`, and writes rows with
`ctx.audit.record`. Four rules keep the set closed:

- **The host qualifies every verb as `<pluginId>:<actionId>`.** No core verb contains a colon, so a
  package can't take a core verb's place or file under another plugin's name. The host mints the id
  from the plugin, never from the descriptor.
- **An undeclared action writes nothing.** `recordAudit` refuses it and warns.
- **The vocabulary stays enumerable.** `auditVocabulary()` lists every declared verb with its label,
  and each audit page carries it, so Settings can name a row it has never seen. A row whose plugin was
  removed draws as its raw qualified verb.
- **The actor is `system`, with the plugin id as `actorId`.** Nothing asked for a plugin's row over a
  request, so it's the Node acting.

`details` holds allowlisted scalars chosen at the call site, never a request body, a credential, or a
file's contents. `plugins/http` is the worked example. It declares `request.sent` and records it only
from its workflow step, with the target's origin and not the URL, because a query string is where a
token ends up when someone puts one there.

## Secret use isn't recorded

The trail records secret creation, replacement, and deletion, not use. Every credential read goes
through `SecretService.use` (`server/core/secrets.ts`), which holds only an encryption key, with no
database, request, or connection id. A row written from there could only name the credential by a
hash of its ciphertext. Recording every read would also turn the table into a request log, because a
mirror refresh reads a provider token on a timer. Auditing only the GitHub read site was rejected too:
partial coverage that reads as complete would let an owner conclude nothing else spends a credential.

## Filesystem and backup

Data roots, credential files, TLS material, databases, WAL files, blobs, and worktrees are created
with restrictive permissions. A Node lock stops two processes opening one root. On macOS the app
reports disk-encryption status and shows a warning when it can't verify full-disk encryption.

Backups snapshot core and plugin SQLite files with SQLite's online-backup API. The output is private
from creation and atomically replaces a prior backup after success. Device rows and credentials are
scrubbed. Blobs and worktrees are left out, because they're recoverable and can dominate the archive.
Restore is a manual step into a fresh data root. [Backup and import](../data-layer/backup-and-retention.md#backup-and-import)
owns the archive contract.
