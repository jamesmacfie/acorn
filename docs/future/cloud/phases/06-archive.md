# Phase 6: idle teardown, archive, and restore

Status: proposed, 2026-09-29.

## Goal

Workers archive their whole data root and disappear after five idle minutes, and nothing is lost.
Plugin detail from a finished task comes back on demand in a fresh, read-only Node with new
credentials.

## What you can deploy at the end

On staging, a finished cloud task's worker is gone within about ten minutes of the last activity,
with a verified, encrypted archive in the team's region. Opening a plugin pane on that task offers
**Restore detail**, which brings the data back in a read-only Node. **Continue** starts a new attempt
from the saved work. Still internal.

## Starting point

- Cloud tasks with manual stop from [phase 5](./05-cloud-task.md).
- The online backup code in `packages/node-core/src/server/routes/security/backup.ts`.
- The design in [archive](../archive.md).

## In scope

- Idle detection and the five-minute window.
- The drain sequence.
- The archive format, manifest, encryption, and upload.
- Verify-then-destroy.
- Restore Nodes, credential rotation, and read-only mode.
- Continuing from a branch, a new snapshot, or an archived worktree.
- Deleting archives, and storage accounting.

## Out of scope

Resuming a worker's live state, such as a running process, from an archive. Retention policies with
automatic deletion.

## Steps and checkpoints

### 1. Idle detection

Define idle from agent turns, running task processes, terminal input and output, and mutating
requests. An agent waiting for a person is not idle unless its harness can checkpoint the question
and resume it.

**Checkpoint 1: idle is idle.** Finish an agent turn and leave the task. After five minutes, the
attempt moves to `stopping`. Start a long `sleep` in a terminal instead: the attempt stays `running`.
Leave an agent waiting on a question: it stays `running`, and the task header says the worker is
still billing.

### 2. The capture experiment

Before writing the format, capture a worker while the agents plugin and a loaded plugin with its own
database both hold SQLite files and blobs. Restore it on another machine and compare every record and
file. List which live resources must be drained first.

Record the findings here. They decide steps 3 and 4.

### 3. Drain and archive

Build the drain, the online backups, the manifest, chunked encryption, and the upload. Decide the key
arrangement: see [archive](../archive.md#encryption).

**Checkpoint 2: an archive verifies.** Stop a worker. An archive appears in the regional bucket. The
team Node marks it verified. The provider shows the machine destroyed afterwards, not before.

**Checkpoint 3: a bad archive stops destroy.** Corrupt one object in the bucket before verification.
Verification fails, the worker stays up, the attempt stays `archiving`, and an alert fires.

**Checkpoint 4: failures keep the worker.** Make the bucket refuse writes. Make the destroy call time
out. In both cases, the attempt stays visible in the right state with a retry, and no machine is lost
or leaked. The provisioner's reconciler agrees with the team Node.

### 4. Restore

Build the restore Node: provision with no model keys, no Git credential, and closed egress; download,
decrypt, and verify; rotate every credential; enroll as a restore Node; refuse every mutation.

**Checkpoint 5: detail comes back.** On a finished task, open a plugin pane that had data, such as
notes or a workflow run. Choose **Restore detail**. The pane shows the original data.

**Checkpoint 6: old credentials are dead.** Against the restored Node, try the worker's old
certificate pin, an old grant for the worker's Node ID, an old internal token, and an old device
token if any existed. Each is refused.

**Checkpoint 7: read-only means read-only.** On the restored Node, try to edit a note, start a
terminal, and run an agent, both from the UI and with a direct API call. Each is refused.

### 5. Continue

**Checkpoint 8: continue from where it stopped.** On an archived task, choose **Continue**. A new
attempt starts from the pushed branch or the archived worktree. Its history appends to the same
logical task, and the client shows both attempts in order.

### 6. Deletion and storage

**Checkpoint 9: delete means gone.** Delete an archived task. Its archive objects disappear from the
bucket, and the team Node's audit trail records the deletion. Storage totals drop.

Remove the phase 5 **Stop and delete** path, or keep it only as an explicit **Discard without
archiving**.

## Acceptance

- No test reports a destroyed worker as archived unless its manifest and every object verified.
- Restore returns every plugin database record and non-refetchable file from the capture experiment.
- Old credentials fail against every restored Node.
- Measured archive size and capture time for a representative task are recorded.

## Docs to update when it ships

- [data layer](../../../data-layer.md): the whole-root archive beside backup.
- [security](../../../security.md): archive encryption, restore credential rotation.
- [state ownership](../../../state-ownership.md): what an archived task keeps and where.

## Open questions

1. Where does the per-team archive key live: on the team Node, in a regional KMS, or both?
2. What container format: tar with an encryption tool such as age, or a custom chunked format with a
   manifest header?
3. How does upload resume after a failure partway through a large archive?
4. What is the restore time target, and does a restore Node need a warm pool?
5. Does a restore Node use the worker image, or a smaller read-only one?
6. What are the default retention rules for archives and snapshots, and does the first release need
   any automatic deletion?
7. Should **Continue** restore the whole root, so plugin state carries forward, or only the worktree?
8. Which agent harnesses can checkpoint and resume a pending question, so a waiting worker can be
   archived?
9. Are logs part of the archive, given they can hold output an agent printed?

## Evidence

Record the capture experiment, archive sizes, and restore times here, with dates.

## Verify before building

Check the backup route's snapshot step, and how each plugin with its own database behaves when its
file is copied while the plugin is quiesced.
