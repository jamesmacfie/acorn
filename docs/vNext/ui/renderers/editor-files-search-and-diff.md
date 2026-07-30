# Editor, files, search and diff

Status: Normative<br>
Requirement prefix: `UI-CODE`

Electron may implement these capabilities with Monaco and virtualized diff components. Those
libraries are implementation details; plugins request semantic capabilities.

## Code editor

- **UI-CODE-001:** An editor model is keyed by canonical file/resource, immutable base revision,
  language ID, encoding, line-ending policy, read/write mode and maximum bytes.
- **UI-CODE-002:** File content is fetched from the owning Node through an authorized resource
  stream. The document does not carry large file bodies or absolute host paths.
- **UI-CODE-003:** Editing requires `core.file.write` or `core.file.code-write` as appropriate.
  Save includes base revision/content hash and fails on conflict without overwriting.
- **UI-CODE-004:** Dirty text is Electron view state and survives pane switching within the session,
  but not Node change, authorization loss, plugin disable or unconfirmed application close. The host
  prompts before discarding.
- **UI-CODE-005:** Reveal/selection intents use 1-based line and column, optional end position and
  focus policy. Out-of-range positions clamp safely and do not create content.
- **UI-CODE-006:** Diagnostics are typed ranges, severity, source, code, message and safe related
  resource intents. Markdown/HTML in messages is not executable.
- **UI-CODE-007:** Language services run only when supplied by trusted Electron/system capability
  or separately authorized Node service. A file's language ID cannot load arbitrary extensions.

## File/resource tree

- **UI-CODE-008:** Tree roots are authorized repository/task resource handles. Entries contain
  relative normalized path, kind, size, revision and symlink metadata; the renderer never joins host
  paths.
- **UI-CODE-009:** Reveal, open, rename, create, delete and move are declared intents/commands with
  path validation, resource version and confirmation. Symlink targets are not followed implicitly.
- **UI-CODE-010:** Hidden/ignored/binary/generated state is explicit and filters are presentation
  bindings. Filtering cannot authorize hidden files.
- **UI-CODE-011:** Open-file tabs persist canonical file IDs and presentation selection, not file
  bodies or dirty buffers. Unknown/missing resources retain a recoverable labeled tab state.

## Search

- **UI-CODE-012:** Search is an authorized Node query with repository/task root, bounded literal or
  safe-regex syntax, include/exclude patterns, result/page caps, deadline and cancellation.
- **UI-CODE-013:** Regex execution uses a bounded safe engine; catastrophic patterns, traversal
  globs and binary bodies are rejected according to query policy.
- **UI-CODE-014:** Each match has resource, revision, line/column, encoded excerpt and match ranges.
  Excerpts are text and capped at 2 KiB.
- **UI-CODE-015:** Selecting a result issues an editor reveal or diff file-scroll intent and
  revalidates the resource on open.

## Diff and review

- **UI-CODE-016:** A diff identifies base/head resources and revisions, files, hunks and lines.
  Patch data streams on demand; summary/list queries do not embed the entire patch.
- **UI-CODE-017:** Renderer supports unified and split modes, virtualized rows, file navigation,
  collapsed unchanged regions, binary/renamed/deleted status, syntax highlighting and find.
- **UI-CODE-018:** Diff body geometry is stable across theme/style packs; add/delete state uses
  marker and background/text, never color alone.
- **UI-CODE-019:** Review comments/suggestions bind to canonical file and side, base/head commit,
  line/range and thread version. A stale mapping is shown and requires explicit relocation.
- **UI-CODE-020:** Draft review state is Node/plugin-owned; unsent text may be client session state.
  Submit is an idempotent GitHub/plugin command with explicit commit point and outcome event.
- **UI-CODE-021:** A local Changes consumer uses the same `acorn.diff-review/2` renderer with local
  Git resources; renderer implementation does not belong to GitHub.
- **UI-CODE-022:** Copy/export/open-external are explicit intents. Diff content never creates
  clickable terminal/file/URL actions by escape sequence or markup.

## Limits and fallback

- **UI-CODE-023:** Default editor limit is 10 MiB text and 1,000,000 lines; diff visible model limit
  is 100,000 rows per file with streaming/windowing. Larger/binary content uses metadata, bounded
  preview, external authorized open or download.
- **UI-CODE-024:** Clients lacking edit capability offer read-only code; lacking diff capability
  offer file summary and bounded patch text; mobile may provide summary/read-only only.

## Acceptance

- **UI-CODE-025:** Tests MUST cover encoding/line endings, conflicts, dirty close, huge/binary files,
  symlink/traversal, safe regex limits, stale search results, diff virtualization, stale review
  anchors, malicious content and capability fallbacks.
