# Whole-root archive and restore

Status: proposed, 2026-09-29. A worker's data root holds everything its plugins wrote. The team Node
keeps core and agent history, but it cannot read plugin databases, and it must not try. So before a
worker is destroyed, its entire data root goes into an encrypted archive in the team's region. A
restore brings that root back on a fresh, isolated Node when someone needs the detail.

## Why the existing backup is not enough

`POST /v1/core/backup` is a precedent for consistent SQLite snapshots, not the cloud archive format
([backup and import](../../data-layer.md#backup-and-import)). It leaves out blobs and worktrees, it
blanks credentials, and restoring it is a manual step into a fresh root. A cloud archive needs:

- Every SQLite database, captured consistently.
- Installed plugin packages and their lockfiles, so the restore runs the same code.
- The task worktree, including uncommitted files.
- Blobs that cannot be fetched again. Refetchable provider mirrors can be skipped.
- A format version, a content manifest with a hash per object, and encryption.
- A restore procedure that never revives old credentials.

## What goes in

| Item | Included | Notes |
| --- | --- | --- |
| `core.sqlite` and `plugins/*.sqlite` | Yes | Online backup API, after the drain. |
| `plugins/<id>/` packages | Yes | So restore does not depend on a registry. |
| `worktrees/` for the task | Yes | Including `.git` objects the remote does not have. |
| `blobs/` | Non-refetchable only | Artifacts, attachments, and patches. |
| `node.json` | Yes | The Node ID is rewritten on restore. |
| `tls/`, `internal-token`, `session.key` | No | A restored Node mints new ones. See [restore](#restore). |
| Device rows, grants, relay credential | No | Deleted or never written to disk. |
| Logs | Optional | Useful for support, but they may hold output an agent printed. Treat as task data. |

Integration credentials inside plugin databases are the hard case. The archive keeps the encrypted
row, but a restored Node has a new `session.key`, so those rows become unreadable. That is the
intended result: a restore is for reading, and a continued run gets fresh cloud connections from the
team Node.

A secret that an agent or plugin wrote into a file or a database in plain text is still in the
archive. Encrypt and restrict every archive as sensitive task data.

## Capture sequence

1. The team Node moves the attempt to `stopping`. The worker refuses new work.
2. The worker asks agents to stop, drains live processes, and closes terminals. It waits for the
   history checkpoint described in [projects and tasks](./projects-and-tasks.md#history-transfer).
3. The worker quiesces plugins, then takes an online backup of each database into a staging folder.
4. It writes a manifest: format version, Node ID, attempt ID, plugin lock digest, and a path, size,
   and SHA-256 for every object.
5. It encrypts the archive in chunks and uploads them to the regional bucket, keyed by attempt ID.
6. The team Node downloads the manifest, checks every object's hash and size against the bucket,
   and records the archive as verified.
7. Only then does the team Node ask the provisioner to destroy the machine.

A failure at any step keeps the attempt visible, keeps the worker alive, and raises an alert. It
never falls through to destroy.

Which live resources need special handling before a consistent capture is a [phase 6](./phases/06-archive.md)
experiment: tmux sessions, open SQLite write transactions, plugin workers, a running dev server, and
Docker state if the Docker plugin is present.

## Encryption

Recommended: envelope encryption. Each archive gets a random data key. The data key is encrypted
with a per-team key, and the encrypted data key is stored in the manifest header. The per-team key
lives on the team Node, wrapped by a key the provider's KMS or the team Node's own sealed storage
holds.

Open question for [phase 6](./phases/06-archive.md#open-questions): whether the per-team key lives
on the team Node, in a managed KMS, or both. Holding it only on the team Node means the control
plane can never decrypt an archive, which fits the three-party rule, but losing the team Node's
volume and its backup loses every archive. A KMS in the team's region, with the team Node as the only
principal allowed to use the key, is the likely answer.

## Restore

A restore is for reading plugin detail from a finished task. It is not a way to resume a worker.

1. A person with read access opens a plugin pane on an archived task and chooses **Restore detail**.
2. The team Node reserves a restore Node and asks the provisioner for a machine, like a worker but
   with no model keys, no Git credential, and egress closed.
3. The restore Node downloads and decrypts the archive, verifies the manifest, and writes the root.
4. It mints a new Node ID, new TLS certificate, new internal signing key, and new `session.key`. It
   deletes any device rows. It enrolls through v2 as a `restore` Node.
5. Clients adopt it read-only. Every mutating route refuses, whatever the grant's role.
6. After the idle window, the restore Node is destroyed without a new archive, because it changed
   nothing.

**Proof the credentials rotated.** Phase 6 must show that an old device token, an old grant, an old
internal token, and the old certificate all fail against a restored Node.

## Retention and deletion

Archives are kept until an authorized team member deletes the task or the archive, or the team is
deleted. Deletion removes the objects from the bucket and records the deletion in the team Node's
audit trail. Storage is metered and billed. A retention policy with automatic deletion can come
later; the first release makes deletion explicit.

## Verify before building

Check the online backup code in `packages/node-core/src/server/routes/security/backup.ts` and whether
its snapshot step can be reused for a full root. Measure archive size and capture time for a
representative task. Check whether the bucket provider can enforce region placement for every
object, including multipart upload parts.
