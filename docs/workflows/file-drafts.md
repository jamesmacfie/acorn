# File drafts and portable export

The editor can open a repository or user workflow file as a draft, and can export a published database
workflow into repository files. This page covers both, and the journals that make them resumable.

## File drafts and portable export

`POST /v1/p/workflows/defs/files` accepts `open`, `save`, `review`, `export`, `publish`, `discard`,
and `list` operations. Device authentication protects this authoring route. File targets identify a
project, a repository or user layer, and a confined `.acorn/workflows/<id>.toml` path.
`workflow_file_drafts` retains the original text/hash, edited definition, and compare-and-swap
revision. Parse failures name the file to repair in a text editor. Static file composition must be
converted before visual editing, so saving an expanded graph cannot erase its original references.

Review merges independent external edits by stable step ID. Conflicting values require an explicit
choice against the reviewed external hash. A deleted file requires restoration. Publication rechecks
the expected hash, writes a unique adjacent temporary file, and renames it. Known external changes
are refused. External editors do not share Acorn's journal, so this is not a filesystem transaction.

The outline editor opens repository and user files through this draft route. It autosaves the visual
draft, shows external changes during review, and requires a conflict choice before publication. It
does not write the source file during ordinary draft editing.

**Export to repository** captures the published workflow graph into sibling files in the selected
project. Workspace originals remain intact. Published saved queries and typed parameter declarations
are embedded inline, database child references become repository references, and repository references
are reused only within the export scope. Cycles, unresolved references, user-file dependencies, and
occupied destination paths are refused. The obsolete `save-to-repo` route refuses destructive export.

Connection selections become required string inputs with a `connection.source` constraint. Export
removes Acorn workspace/project scope IDs, while retaining provider project/state IDs in the review.
Run admission binds the destination workspace/project and validates connection and provider choices
through the source runtime before starting. Destination scope parameters must resolve before admission.
Filter values bound to runtime records are validated by the data step when those records exist.
Credentials are not read by export.

`workflow_file_operations` retains each intended file, original hash, dependency hash, and landed
status. Resume verifies completed writes and continues the same plan after interruption, including a
rename that landed before its journal acknowledgment. A review with no written files can be discarded.
Affected file definitions cannot run until their publication completes. Publication leaves ordinary
uncommitted changes; repository run admission still applies configuration trust.

`plugin:workflows:defs-changed { workspaceId }` goes out on every write.

A deleted project leaves its rows behind with a `projectId` that resolves to nothing. The merged list
marks those rows rather than hiding them, so they can be rebound or deleted instead of vanishing.
