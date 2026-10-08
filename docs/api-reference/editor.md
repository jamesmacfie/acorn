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
writes to the same canonical checkout serialize with file actions. External writers can still change the file between the
comparison and write. [Saving and recovery](../editor/save-and-recovery.md) describes the client
owner and the recovery record.

## Other file routes

`GET …/files` returns the flat string array used by agent mentions. `GET …/list?path=` returns
directory entries for the file tree. Entries include `name`, `dir`, `kind`, `identity`, and `root`.
The added fields let a menu carry the entry it saw. Image and line-marker reads keep their separate
contracts.

`POST …/ignored` accepts `{ path, names }` for one requested directory. It returns
`{ available: true, ignored: string[] }` or `{ available: false, ignored: [], reason }`. The Node
caps the batch at 10,000 names and 256 KiB, confines the directory, and reads Git's NUL-delimited
ignore output. A failed ignore read leaves the ordinary listing usable.

`POST /v1/p/editor/tasks/:id/search` accepts a query and optional `opts` with `caseSensitive`,
`wholeWord`, `regex`, `folder`, `include`, and `exclude`. Folder is task-root-relative and confined
before ripgrep starts. The Node limits each filter to 20 patterns, each pattern to 256 characters,
and both filters to 4 KiB. Results have task-root-relative paths, one-based UTF-16 columns, and a
2,000-match cap. Invalid query or filters return 400; missing or escaped scope returns 404.

## Manage tree entries

`GET …/entry?path=` returns `{ root, path, kind, identity }`. An empty path names the root for
creation. The Node refuses Git metadata and paths outside the checkout. Entry identity comes from
the Node's `lstat` result and is checked again inside the mutation lock. A replaced entry fails.

The device-only mutation routes are `POST …/create`, `POST …/rename`, and `POST …/trash`. Create
takes `{ parent, name, kind: "file" | "folder" }`; rename takes `{ source, name }`; trash takes
`{ source }`. `parent` and `source` are captured entry envelopes. Results are `{ ok: true, path }`
or `{ ok: false, reason, partial? }`. A partial trash result means the command failed after the
entry disappeared; refresh before deciding what to do next. An older Node returns a route error, so
the client does not infer success or mutate its document state.

`GET …/trash-availability` reports whether the Node has a supported host trash command. On macOS,
the Node uses `/usr/bin/trash`; on Linux, it uses `gio trash`. Other hosts report unavailable.
The Node runs the command through its process broker and verifies the source is absent after a
successful exit. It never falls back to permanent deletion. Permissions and filesystem-specific
trash failures remain operation results. Restore an entry from the owning Node's system Trash.
