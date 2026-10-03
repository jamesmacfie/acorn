# The data root

This page covers the directory a Node keeps everything in: where it lives, what's in it, and how the
Node opens it. Read it before you add a file to the root. It's part of the
[data layer](../data-layer.md).

## Where it lives

Development uses `apps/node/.acorn/`, a packaged desktop build uses the OS application-data root, and a
standalone Node uses `ACORN_DATA_DIR` or the development default. The root is mode `0700`, and an
exclusive `node.lock` protects it, so only one process opens it.

```text
<data-root>/
  core.sqlite
  plugins/<name>.sqlite        plugin databases
  plugins/<id>/                installed plugin packages
  blobs/                       the content-addressed blob cache
  worktrees/                   task worktrees
  notes/                       task, workspace, and global notes, as markdown
  tls/{key.pem,cert.pem}
  logs/
  node.json
  node.lock
  internal-token               the internal token signing key
  session.key                  SESSION_ENC_KEY, when the environment doesn't supply it
  active-identity              the node-owner id
```

`packages/node-core/src/server/storage/dataRoot.ts` owns the layout. Worktrees are ordinary
directories, not a database cache. [Node distribution](../node-distribution.md#operations) covers
modes on Windows, where they're advisory.

## `node.json`

`node.json` stores the stable Node ID, its creation time, the last-bound port, the operator's
`advertiseHost` answer, and, only on a provisioned Node, the attachment record naming its control plane
([node enrollment](../node-enrollment.md#the-attachment-record)). It holds no certificate material,
which lives in `tls/`, and no protocol version. Its schema ignores unknown keys, so a field can be
retired without stranding roots that still carry it.

Every write to `node.json` is a read-modify-write against the file, not a serialization of whatever the
open `DataRoot` last held. Two owners write it, this process's data root and the detach route in a later
process, and a writer that serialized its cached copy would drop the other's field.

## Opening a root

`openDataRoot` creates the identity, takes the lock, and refuses an incompatible root. It refuses rather
than minting a fresh identity, because a root with paired devices must not have those pairings orphaned
by a new random ID. Each owner's migration chain applies its own upgrades
([migrations](./migrations.md)). Backups are explicit archives and never change their source.

Files written once into the root, the Node identity, the session key, and the active-identity file,
use an atomic write: a temporary file, an fsync, then a rename, so a crash can't leave a truncated
file.

The recoverable reset command is in [local development](../local-development.md). It names each
selected root, inventories the files it owns, and never removes `worktrees/` or a whole data root.
