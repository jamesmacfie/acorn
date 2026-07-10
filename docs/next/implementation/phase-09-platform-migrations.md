# Phase 9 — Platform migrations

**Status:** planned · **Depends on:** none strictly; schedule opportunistically
· **Primary docs:** [review](../review.md) technology changes,
[feature parity](../feature-parity.md) §13 and §18,
[security](../security.md).

## Goal

Execute platform migrations that reduce technical load or unblock better UX, but
do not gate the core extension sequence. Each migration is independently
shippable and should not be bundled with unrelated architecture work.

## Required Context

Read these sections before implementation:

- [review.md](../review.md) technology choices rank the platform migrations and
  distinguish useful simplification from optional churn.
- [feature-parity.md](../feature-parity.md) §13 defines preview/browser parity;
  §18 defines dev/build/package operational contracts.
- [security.md](../security.md) §2 lists invariants that must survive platform
  changes; §3 covers transport/loopback rules; §6 covers secrets posture.
- [performance.md](../performance.md) §1.5 and §3.6 are relevant to migrations
  that touch app launch; §3.3 applies if preview/browser transport changes
  interact with PTY or stream work.
- [testing.md](../testing.md) §1 defines smoke tests that should gate preview,
  boot, storage, or app-launch changes.
- [docs-overhaul.md](../docs-overhaul.md) §2 names Electron,
  local-development, packaging, and operational docs that must track migration
  outcomes.

These migrations are not a license to reopen core architecture. Each one should
either reduce platform coupling, retire a brittle dependency, or improve a
documented UX/security constraint.

## Design Guardrails

- **Extensibility:** platform services should expose stable core capabilities
  that plugins can consume later, not product-specific shortcuts.
- **Simplicity:** each migration is isolated and reversible. Do not combine a
  platform migration with registry, transport, or foldering design work.
- **Robustness:** preserve storage origin, auth/session behavior, preview
  security restrictions, and operational scripts before claiming a migration is
  complete.
- **Maintainability:** if a spike question fails, document the decision and stop
  rather than forcing the codebase onto a weaker abstraction.

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
- Preview ownership is main-process/platform code; product panes consume a
  capability rather than embedding platform details.
- Degraded browser-mode behavior remains aligned with
  [feature-parity.md](../feature-parity.md) §17 where WebContentsView is not
  available.

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
- The migration does not weaken transaction behavior used by Phase 2 mirror
  writes or Phase 7 provider codecs.
- Packaging and local-development docs state exactly which native rebuilds
  remain necessary after the decision.

## Migration C — safeStorage path

Use Electron `safeStorage`, not keytar, for planned keychain work.

### Goals

- Move `SESSION_ENC_KEY` first.
- Keep the threat model in [security](../security.md) current.
- Avoid speculative packaging work until packaging actually needs it.

### Acceptance Criteria

- `SESSION_ENC_KEY` storage has a documented read/write/migration path and a
  failure mode that does not silently create a second identity.
- Secrets remain absent from logs, responses, and persisted renderer state.
- The security doc's secrets posture matches the shipped storage behavior.

## Cross-Migration Acceptance Criteria

- Each migration has its own PR or clearly isolated PR stack.
- Operational scripts and docs are updated in the same PR.
- The app preserves stable `127.0.0.1:4317` storage origin and `ACORN_PORT`
  override.
- `dev:node` remains first-class.
- Migrations that touch preview, storage, boot, transport, or packaging include
  before/after notes for affected parity sections.
- Any deferred migration has a written stop reason, not an ambiguous TODO.

## Verification

- `pnpm lint`
- `pnpm test`
- Smoke suite for any migration touching preview, boot, transport, storage, or
  app launch.
- Migration-specific visual/live checks listed above.
- Operational script dry run for any changed script path.
- Documentation check for `docs/electron.md`, `docs/local-development.md`, and
  packaging/ABI notes touched by the migration.

## Outcome (2026-07-10)

- **Migration A — WebContentsView: implemented.** `main/previewService.ts` owns one
  `WebContentsView` per task (parented to `win.contentView`); the renderer drives lifecycle/chrome
  and positions it over the pane host rect (`PreviewPane.tsx`), main pushes chrome state back over
  `preview:*` IPC. Per-view http(s)-only / no-userinfo guard (`isAllowedPreviewUrl`) replaces
  `will-attach-webview`; the CDP driver binds inside main on view creation, so `browser:bind` and the
  `webviewTag` are gone. Overlay occlusion is handled renderer-side by hiding the view when a probe
  finds the pane covered (documented ceiling: centre-point probe, corner-only overlays not detected).
  Degraded browser mode shows a "needs the desktop app" gate. **Static verification done** (lint,
  full test suite, `electron-vite build`, CDP driver smoke). **Pending interactive sign-off:** the
  visual preview pass, pane/task-switch state preservation, and live occlusion behaviour — these need
  a human driving a real workspace with a running dev server.
- **Migration B — node:sqlite: PARKED.** Spike question #1 fails: Drizzle ships no `node:sqlite`
  driver (verified against latest 0.45.2). `node:sqlite` itself handles FTS5(porter) + transactions
  under the bundled Node, but adopting it would mean the generic `sqlite-proxy` driver or dropping
  Drizzle, and `node-pty` keeps the dual-ABI rebuild alive regardless. Stop reason recorded in
  `docs/local-development.md`. Revisit if Drizzle adds a first-party `node:sqlite` driver.
- **Migration C — safeStorage: implemented.** `main/sessionKeyStore.ts` resolves `SESSION_ENC_KEY`
  (env wins and migrates to safeStorage → fresh-root mint; an existing DB without either source and
  decrypt failures are fatal to avoid a second identity), covered by `sessionKeyStore.test.ts`.
  Security/electron/CLAUDE docs updated.

## References

- [review.md](../review.md) technology changes #2-#4.
- [feature-parity.md](../feature-parity.md) §13 and §18.
- [security.md](../security.md) §6.
- [docs-overhaul.md](../docs-overhaul.md) §2 for Electron, local-development,
  and operational docs.
