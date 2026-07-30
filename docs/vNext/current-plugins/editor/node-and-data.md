# Editor Node and data model

**Status:** Normative current-plugin migration<br>
**Requirement prefix:** `CUR-EDITOR`

## Resource model

| Resource | Required fields |
| --- | --- |
| `acorn.editor.root` | task URI, repository URI, worktree generation, display name, availability |
| `acorn.editor.entry` | file URI, parent URI, relative path, name, kind, size, revision, symlink state |
| `acorn.editor.file` | entry fields plus encoding, line endings, language hint and content stream |
| `acorn.editor.search` | task URI, normalized query/options, snapshot sequence, truncation and pages |
| `acorn.editor.match` | file URI/revision, 1-based line/UTF-16 columns, bounded text excerpt/ranges |

`CUR-EDITOR-020` File URIs use the owning Node authority and immutable task/worktree generation.
A relative path is an attribute; a task checkout replacement invalidates old file handles even
when the path text is unchanged.

`CUR-EDITOR-021` The Node derives repository, worktree root and current generation from the task
URI. Client-supplied repository names, absolute paths, roots or worktree generations are ignored.

`CUR-EDITOR-022` Every file operation reauthorizes the task and file scope. The broker confines
paths component-by-component beneath the task root and rejects absolute paths, empty traversal
segments, NULs, alternate streams, case-folding ambiguity and symlink/reparse escapes.

`CUR-EDITOR-023` Symlinks are returned as explicit metadata and are not followed by default. A
separately granted follow operation may open a target only when the resolved target remains inside
the same authorized root.

## Root and directory queries

`CUR-EDITOR-024` `editor.root.get@2` returns availability, safe checkout display name, task and
repository URIs, generation and revision. It never returns an absolute host path.

`CUR-EDITOR-025` `editor.entries.list@2` accepts a parent file-resource URI, opaque cursor, limit
1–1,000 and optional hidden/ignored filter. Results are directories first, then locale-independent
code-point name order, with a stable tie-breaker by URI.

`CUR-EDITOR-026` The default tree hides `.git` administrative state, dependency/cache directories
identified by core policy, ignored files and unsupported device entries. The response declares
each applied filter; filtering does not change authorization.

`CUR-EDITOR-027` Directory pages are snapshot-consistent. A changed worktree returns a new snapshot
sequence; a cursor from another task, generation, filter or sequence is rejected.

`CUR-EDITOR-028` Missing task, lost checkout, inaccessible directory and invalid/escaped path have
distinct safe errors. Directory absence does not collapse to an empty successful list.

## File enumeration, read and write

`CUR-EDITOR-029` `editor.files.list@2` returns tracked plus non-ignored untracked files through the
core repository capability. It is pageable, cancellable and bounded; it does not shell-expand or
walk ignored dependency trees.

`CUR-EDITOR-030` Quick-open filtering is performed by a deterministic bounded fuzzy query. The
Node MAY return ranked matches directly, but the result carries score-independent stable file URIs
and the authoritative revision.

`CUR-EDITOR-031` `editor.file.read@2` accepts a file URI and optional byte range. Text reads declare
`utf-8`, detected BOM, line-ending style, current revision/hash, total bytes and truncation. Invalid
UTF-8, binary content and files above negotiated limits return metadata plus an explicit
unsupported/stream option rather than replacement characters.

`CUR-EDITOR-032` The default editor limit is 10 MiB and 1,000,000 lines as required by
[`UI-CODE-023`](../../ui/renderers/editor-files-search-and-diff.md). Larger content requires an
authorized bounded stream or external-open intent.

`CUR-EDITOR-033` `editor.file.write@2` requires file URI, complete UTF-8 content or ordered patch,
expected revision, line-ending policy and an idempotency key. The Node validates the resource again
immediately before an atomic same-directory replace.

`CUR-EDITOR-034` A successful write preserves mode bits, applies the declared line-ending policy,
fsyncs according to core durability policy, increments the resource revision, and returns the
canonical content hash. It emits the core file-updated fact only after commit.

`CUR-EDITOR-035` New-file creation and directory creation are separate confirmed commands. Save
does not create missing parent directories, follow a replaced symlink, or turn a missing known file
into a new one.

`CUR-EDITOR-036` A revision mismatch returns `conflict` with current revision and safe metadata but
not the newer body unless the caller is still authorized to read it. The Client retains dirty text
and offers compare, reload or explicit merge; blind retry is prohibited.

`CUR-EDITOR-037` Repeated writes with the same idempotency key and identical canonical input return
the original result. Reuse with different content returns `idempotency_conflict`.

## Search

`CUR-EDITOR-038` `editor.search.query@2` accepts task URI, non-empty query up to 4 KiB, mode
`literal|safe-regex`, case and whole-word flags, bounded include/exclude globs, page size up to 500,
total ceiling 2,000, deadline up to 10 seconds, and cancellation.

`CUR-EDITOR-039` Search honors repository ignore policy and skips binary bodies by default.
Hidden/ignored/binary inclusion requires corresponding read authority and explicit options.

`CUR-EDITOR-040` Regex uses a bounded safe engine or statically rejects constructs that can cause
catastrophic work. Bad syntax returns `validation_failed`; timeout, cancellation and no matches
are distinct outcomes.

`CUR-EDITOR-041` Each match carries file revision, 1-based line, 1-based UTF-16 start/end columns,
and a text excerpt capped at 2 KiB. UTF-8 engine byte offsets are converted before crossing the
contract.

`CUR-EDITOR-042` Search output is capped by both count and encoded bytes. `truncated` identifies
which bound was hit; pagination cannot imply completeness after worktree mutation.

`CUR-EDITOR-043` Search subprocess selection, if used, is a host-owned fixed tool with fixed
executable, `--no-config`, structured output, explicit cwd handle, sanitized environment, 10-second
deadline, 32 MiB process-output ceiling and kill-on-cancel. Plugin input never enters a shell.

## Storage and retention

`CUR-EDITOR-044` Editor has no durable Node database in V2. Core audit/idempotency/event records
may refer to file URIs, revisions, operation class and result, but never store file bodies, search
excerpts or absolute paths.

`CUR-EDITOR-045` Node-side ephemeral search indexes or result pages are cache-class storage,
task/generation scoped, encrypted by the device's full-disk protection, capped at 128 MiB per
installation and deleted on task archive, generation change, uninstall or 24-hour inactivity.

`CUR-EDITOR-046` Editor contributes no backup payload. Worktree backup is outside plugin backup
semantics; Client tab metadata participates only in normal Client preference backup if the owner
enables it.

`CUR-EDITOR-047` Task archive cancels reads/searches/writes not past commit, invalidates file
handles, removes ephemeral caches and publishes only core task/file lifecycle facts.

`CUR-EDITOR-048` Plugin disable or Node restart cancels fixed-tool searches and discards ephemeral
pages. File bytes already committed remain authoritative; idempotency records distinguish a
committed result from a safe retry.

`CUR-EDITOR-049` Conformance MUST cover case sensitivity, Unicode normalization, invalid UTF-8,
BOM/line endings, symlink replacement, traversal, checkout replacement, huge files, cancellation,
search byte/row caps, concurrent edits and atomic-write failure.
