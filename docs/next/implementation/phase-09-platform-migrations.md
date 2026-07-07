# Phase 9 — Platform migrations

**Status:** planned · **Depends on:** none strictly; schedule opportunistically
· **Primary docs:** [review](../review.md) technology changes,
[feature parity](../feature-parity.md) §13 and §18,
[security](../security.md).

## Goal

Execute platform migrations that reduce technical load or unblock better UX, but
do not gate the core extension sequence. Each migration is independently
shippable and should not be bundled with unrelated architecture work.

## Migration A — Webview to WebContentsView

Move the preview pane from `<webview>` to `WebContentsView`.

### Goals

- Main-owned preview attachment.
- Bounds managed by the pane host.
- One kept-alive browser surface per task.
- Compatibility with `browserService.ts` CDP binding.
- Cleaner composition with Phase 5 keep-alive slots.

### Acceptance Criteria

- Preview survives pane and task switches with page, scroll, and form state.
- Human browser chrome still works: back, forward, reload, stop, home, editable
  URL, loading state.
- Home URL priority is preserved: recipe `browser=run:<id>` -> default run
  target -> workspace preview config -> dev-server fallback.
- Agent `browser_*` tools drive the task's preview surface.
- Archive eviction works.
- Non-http(s) navigation is blocked through an equivalent of the current
  `will-attach-webview` restriction.
- `browser:bind` stays IPC-only.

### Verification

- Visual preview pass.
- Agent browser-tool pass.
- Security test/pass for blocked non-http(s) navigation.
- Pane/task switch preservation pass.

## Migration B — better-sqlite3 to node:sqlite

Spike before committing.

### Spike Questions

- Is the Drizzle driver mature enough for this app?
- Does Electron's bundled build include FTS5 for memory index use?
- Can `db.batch` / transaction atomicity used by mirror writes be preserved?

### Acceptance Criteria

- If any spike question fails, park the migration and document why.
- If it proceeds, mirror writes remain atomic and memory FTS behavior is
  preserved.
- ABI rebuild scripts are updated but node-pty rebuild needs remain understood.

## Migration C — safeStorage path

Use Electron `safeStorage`, not keytar, for planned keychain work.

### Goals

- Move `SESSION_ENC_KEY` first.
- Keep the threat model in [security](../security.md) current.
- Avoid speculative packaging work until packaging actually needs it.

## Cross-Migration Acceptance Criteria

- Each migration has its own PR or clearly isolated PR stack.
- Operational scripts and docs are updated in the same PR.
- The app preserves stable `127.0.0.1:4317` storage origin and `ACORN_PORT`
  override.
- `dev:node` remains first-class.

## Verification

- `pnpm lint`
- `pnpm test`
- Smoke suite for any migration touching preview, boot, transport, storage, or
  app launch.
- Migration-specific visual/live checks listed above.
- Operational script dry run for any changed script path.
- Documentation check for `docs/electron.md`, `docs/local-development.md`, and
  packaging/ABI notes touched by the migration.

## References

- [review.md](../review.md) technology changes #2-#4.
- [feature-parity.md](../feature-parity.md) §13 and §18.
- [security.md](../security.md) §6.
- [docs-overhaul.md](../docs-overhaul.md) §2 for Electron, local-development,
  and operational docs.
