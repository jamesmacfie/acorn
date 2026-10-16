---
title: Back up and restore
description: Save a Node's databases to one file, what the backup leaves out and why, and restore it into a fresh data folder.
sources:
  - docs/data-layer/backup-and-retention.md
  - docs/data-layer/data-root.md
  - packages/node-core/src/server/storage/backup.ts
  - packages/client-core/src/features/settings/SecuritySettings.tsx
  - scripts/verify-backup.mjs
checked: 07aa959a0
---

A backup saves a Node's databases to one file on the Node's machine: your workspaces, projects, tasks,
agent transcripts, workflows, saved queries, and saved requests. This page covers making one, what it
leaves out, and restoring it. A backup never changes the Node it came from, so you can take one while
the Node is running.

## Make a backup

1. Open **Settings** > **Machines** > **Security**. With more than one Node, pick the Node in the
   header.
2. Under **Backup**, **Save to** suggests `acorn-backup-<date>.tar.gz` in the home folder of the Node's
   machine. Change it if you like. It must be a full path on that machine.
3. Click **Back up this node**.

The backup is a `.tar.gz` file readable only by the Node's user. A second backup to the same path
replaces the first, but only once the new one is complete, so a failed backup leaves the old one in
place. Keep backups somewhere other than the data folder, so they don't disappear with it.

## What it leaves out

| Left out | Why |
| --- | --- |
| Credentials for connections such as GitHub | A backup shouldn't be a way to take them. Each connection is still listed after a restore, so you see what to connect again. |
| Paired devices | A device's token is a key to the Node. After a restore, pair each device again. |
| The Node's certificate and keys | They belong to that Node. The restored Node has a new identity, with new words. |
| Worktrees | They're Git checkouts. Push your branches, and acorn makes new worktrees. |
| Notes and memory | They're Markdown files, outside the databases. Copy `notes/` from the data folder, and the memory folder, yourself ([Where your data lives](/docs/nodes/where-your-data-lives/)). |
| The blob cache | It's often the largest thing in the folder, and acorn can fetch it again. |

The file has a `manifest.json` that lists the databases in it and everything it leaves out.

## Restore a backup

Restore into a new, empty data folder, never over a Node in use. You need a checkout of acorn for the
check in step 2.

1. From a [standalone Node](/docs/nodes/run-a-standalone-node/)'s folder, start a Node on a new data
   folder once, so it sets the folder up. Once it prints **acorn node ready**, stop it with Ctrl+C.

   ```sh
   ACORN_DATA_DIR=/var/lib/acorn-restored npm start
   ```

2. Check that the backup and the folder are the same format. In the checkout, run:

   ```sh
   pnpm backup:verify acorn-backup-2026-10-16.tar.gz /var/lib/acorn-restored
   ```

   You should see **Backup and target root use the acorn-1 baseline.** If it refuses, the backup is from
   a format this Node can't read, and nothing was changed.

3. Unpack the backup, then copy `core.sqlite` into the data folder and every other `.sqlite` file into
   its `plugins/` folder, replacing what's there. Delete any `core.sqlite-wal` or `.sqlite-shm` files
   beside the ones you replace first.

   ```sh
   mkdir restore && tar -xzf acorn-backup-2026-10-16.tar.gz -C restore
   rm -f /var/lib/acorn-restored/*.sqlite-* /var/lib/acorn-restored/plugins/*.sqlite-*
   cp restore/core.sqlite /var/lib/acorn-restored/
   find restore -name '*.sqlite' ! -name core.sqlite -exec cp {} /var/lib/acorn-restored/plugins/ \;
   ```

4. Start the Node on that folder.

   It prints a new pairing code, because the backup holds no paired devices.

5. Pair each device again ([Pair a device or a remote Node](/docs/nodes/pair-a-device-or-a-remote-node/)),
   then connect GitHub and your other connections again.

The restored Node is a new Node to your devices, with a new ID and new identity words. Unpair the old
one in **Settings** > **Machines** > **Nodes** if it's gone.

Before a task or a workflow runs something from a project's `.acorn/config.toml` or a workflow file,
acorn may ask you to trust it again.

## Limits

- There's no restore button. Restoring is the manual steps above.
- A backup restores only into the same format, `acorn-1`. There's no upgrade from an older format.
- Settings stored on your device, such as appearance and shortcuts, aren't on the Node, so they're not in
  its backup.
