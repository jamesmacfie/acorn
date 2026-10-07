# Editor file routes

The Editor plugin owns task worktree reads and writes under `/v1/p/editor/tasks/:id/editor/`.
These routes use the same task and path confinement as the other Editor file routes.

## Read and write text

`GET …/read?path=` returns `{ text, revision }`. The revision is a SHA-256 of the original UTF-8
bytes, including a byte order mark and line endings. A missing file returns `404 not_found`; a task
without a worktree returns `404 no_worktree`. Other read failures do not claim deletion.

`PUT …/file` requires `{ path, content, expectedRevision }`. A 64-character lowercase hex revision
saves an existing file. `null` creates an absent file. Omitting the field or sending an invalid value
returns HTTP 400, including for older clients. A mismatch returns
`{ ok: false, kind: "conflict" | "deleted", reason }` without writing. Other write failures use
`kind: "failure"`. Success returns `{ ok: true, text, revision }` with the post-hook body and its
revision. A graphical client rejects a read envelope without a valid revision and asks for a Node
update. A Node that rejects the write precondition also prompts an update; the client does not retry
without it.

The Node runs before-save hooks before it compares the expected revision, then writes. Editor-owned
writes to the same canonical file serialize. External writers can still change the file between the
comparison and write. [Saving and recovery](../editor/save-and-recovery.md) describes the client
owner and the recovery record.

## Other file routes

`GET …/files` returns the flat string array used by agent mentions. `GET …/list?path=` returns
directory entries for the file tree. Image and line-marker reads keep their separate contracts.
