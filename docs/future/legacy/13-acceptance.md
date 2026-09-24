# Ticket 13: Acceptance and documentation

Date: 2026-09-21. Status: implementation acceptance recorded with host limits, 2026-09-23.
Prerequisites: 01–12.
Read [context](./context.md), [target architecture](./target-architecture.md), and
[reset policy](./reset-and-versioning.md).

## Outcome

The implementation has one supported `acorn-1` baseline, plugin-owned contracts, and a recoverable
disposable reset. Reference docs describe the current behaviour. The checks below separate automated
proof from real-host transitions that remain unverified; this is not a production-release sign-off.

## Verification matrix

| Area | Required evidence |
| --- | --- |
| Static contracts | `pnpm lint`, architecture tests, facade surface tests, published declaration/SDK parity, no forbidden dependency or concrete plugin route in shared packages. |
| Database | `pnpm db:check`, constraint/index checks for every baseline, rejection of old histories, fresh compiled/loaded startup. |
| Whole suite | `pnpm test`, using the wrapper's bounded concurrency. Record failures; do not substitute an unbounded Turbo run. |
| Plugin lifecycle | Fresh install, missing dependency, failure rollback, disable, reload, re-enable, uninstall, and restart. Confirm scoped authority and no stale callbacks. |
| Extensibility | A fixture plugin contributes command, data source, event, and hook through documented APIs without a core implementation edit. Findings preparation works with a non-Memory test target. |
| Reset | Disposable mixed-root fixture, dry run, exact artifact export, interruption/resume, live-writer refusal, symlink refusal, untouched worktrees/repositories/external resources, old-snapshot recovery. |
| Compatibility rejection | Historical version-1 input with no baseline, mismatched baseline, old API major/routes, old workflow format, old root, and wrong service handshake. |
| Desktop | Isolated real Tauri window: onboarding/pairing, plugin trust, task create, notes/context, proposal approval, terminal send, workflow promotion/retry, shortcuts, and restart. |
| Terminal | Fresh custody/cache, same plugin contracts and session-source actions, keyboard scope/focus, node switching, and restart. Record separately that the TUI has no Terminal drawer or session PTY surface. |
| Standalone Node | Packaged migration discovery, bundled plugin loading, pairing/reconnect, and orderly drain without desktop dependencies. |

For desktop use `pnpm dev:agent -- --session legacy-review`, followed by
`pnpm dev:agent:ui -- --session legacy-review snapshot`. Re-snapshot after transitions, capture
screenshots, and finish with `pnpm dev:agent:ui -- --session legacy-review stop`. Native keychain/menu
behaviour requires native host checks beyond the renderer driver. Use `pnpm --filter @acorn/desktop test`
for the staged boot and Rust suite.

## Documentation handoff

Update architecture, conventions, plugin map/reference/authoring, contribution kinds, API, data-layer,
state-ownership, shell, terminal, Findings/Memory, workflows, and testing pages where their contracts
changed. Update root and future indexes. Mark historical workflow transition evidence superseded without
presenting it as an operating command. Keep one owner for each contract and link to it.

Record final dispositions for F01–F12: implemented and verified, explicitly retained, or deferred with a
concrete reason. An untested change is not complete. Do not claim production release readiness merely
because architecture checks pass. No real-state reset or deployment is required by this ticket.

## F01–F12 disposition

The findings document records the pre-implementation source trace. These are the outcomes of the
ordered implementation; the reference pages own the current contracts.

| Finding | Disposition | Owner and retained boundary |
| --- | --- | --- |
| F01, duplicate review proposals | Implemented in 03; integration verified. | Findings accepts proposals and prepares a selected registered target; Memory keeps approval receipts and its private library. Real-window approval remains unrun. |
| F02, feature policy in composition | Implemented in 04; lifecycle verified. | Producer events, bounded read contracts, and the awaited archive hook replace composition callbacks. Process boot and drain remain in composition. |
| F03, duplicate task context | Implemented in 05; API verified. | Core task fields and contributed sections are the single response shape. |
| F04, plugin domain types in shared packages | Implemented in 06; architecture verified. | Workflow and agent types and forms live with their plugins; core keeps tool authorization. |
| F05, Terminal routes in core | Implemented in 07; source tests verified. | Terminal owns session routes and full rows; core consumes summaries and actions through contributions. The TUI drawer gap is recorded below. |
| F06, second workflow cost source | Implemented in 06; workflow tests verified. | The turn-admission ledger owns run totals; step costs remain step data. |
| F07, automatic state adoption | Implemented in 02; custody tests verified. | Device preferences and custody no longer import retired stores at startup. Explicit reset/export remains separate. |
| F08, implicit plugin contracts | Implemented in 08; SDK and architecture verified. | Commands require a kind; host call modes and portable SDK declarations are checked. API ranges remain for future independent plugin updates. |
| F09, small compatibility aliases | Implemented in 05 and 12; focused tests verified. | Credential envelopes, model IDs, notes routes, and encrypted-column names have one form. `core.projects.byGithub` and provider codec fixtures were retained for their live callers. |
| F10, reset and migration drift | Implemented in 01 and 09; reset and DB gates verified. | Reset inventories all owned state and fresh databases use one baseline migration per owner; future migrations still append normally. |
| F11, coordinated version cutover | Implemented in 10; admission tests verified. | The `acorn-1` marker gates historical version-1 artifacts across runtime, plugin, workflow, and backup admission. |
| F12, exports and focused simplification | Implemented in 11 and 12; build and behavior verified. | Closed package exports and pure command/terminal helpers landed; stateful workflow and agent machines were explicitly retained. |

## Implementation acceptance record

These results are from this worktree on 2026-09-23. An area with a remaining manual check is not a
release-ready claim.

| Area | Result and evidence |
| --- | --- |
| Static contracts | `pnpm lint --env-mode=loose` passed 34/34 uncached tasks. Architecture: 5 files/66 tests passed after fixing the palette's host-command edge and stale `session.ts` assertion. Plugin types: 4 tests; SDK: 2 tests. TUI startup graph is 1,118,096 B/123 eager chunks, under the unchanged 1,130,000 B cap; narrow supported imports removed accidental DOM/virtualizer loads. |
| Database | `pnpm db:check` passed all 11 fresh baseline chains on temporary databases. Node integration tests cover fresh startup, constraints, indexes, and rejection of historical migration history. |
| Whole suite | The exact `pnpm test --env-mode=loose` wrapper passed 35/35 tasks after the last code/test edit: Node-core 119 files/1,194 tests, client-core 211/1,720, TUI 46/589 with 2 skipped, desktop 16/102 and Rust 39/39. `pnpm_config_verify_deps_before_run=warn` avoided pnpm 11's attempted offline module purge; no install ran. A default-sandbox rerun was stopped after localhost listeners failed with `EPERM`; both permitted host runs passed 35/35. |
| Plugin lifecycle | Installer, loader, reload, host, and disabled-plugin tests cover fresh admission, missing dependency, candidate rollback, revoked old handles, reload, re-enable, uninstall, and sticky bundled uninstall. A complete lifecycle through the real window was not exercised: the isolated session had no candidate bundle to trust. |
| Extensibility | A disk-loaded fixture admits a command, data source, declared event, and hook together (3/3); separate authority, scoping, and execution tests pass. Findings prepares a non-Memory `other:change` target in the runtime suite. |
| Reset | Disposable mixed-root reset tests passed 8/8: dry run, exact export/recovery, interruption/resume, live writer and symlink refusal, protected repository/worktree paths, and desktop staging. Backup verifier passed 2/2. No real user root was reset. |
| Compatibility rejection | Focused Node, custody, workflow, manifest, backup, root, and service tests reject missing/mismatched `acorn-1`, old API routes and majors, old workflow files and histories, and wrong service handshakes. No old root was adopted. |
| Desktop | Desktop package passed 16 files/102 tests and Rust 39/39. Staged-renderer real Tauri onboarding smoke reached “Add your first project”; an isolated project window created a task and note, opened the palette, published a workflow, and retried its failed run. Its Recent Runs deep link exposed a race; Workflows now seeds only the clicked task's availability and its focused test passes 2/2. A disposable Shell tab accepted `printf ACORN_TERMINAL_SEND_OK_FINAL` through xterm input; the Node-owned PTY stream carried both echo and command output, then the shell prompt. The session was stopped and the service drained. Unverified transitions are listed below. |
| Terminal | TUI passed 46 files/589 tests with 2 skipped, plus real PTY runs against a disposable root: first boot minted a 0600 device token and cache, a warm attached Node showed project/task navigation, and a supervised restart recovered a cached task pane after initial `ECONNREFUSED`. The navigation picker now refreshes on roster changes; its local-search test passes 3/3 and pane-recovery test 1/1. TUI Terminal drawer selection/input is absent by design; shared session-source send identity/reload tests pass 5/5. |
| Standalone Node | `pnpm pack:node` produced a package with 11 staged migrations and 14 declared dependencies. The unpacked artifact booted against a disposable root, reported the `acorn-1` handshake, and drained with exit 0. Pairing/reconnect and bundled plugin loading passed focused integration tests; they were not exercised through the unpacked artifact UI. |

## Real-host limits

- The Tauri renderer driver proved onboarding, task/note navigation, command palette, workflow
  publish, recent-run navigation, retry, and restart on an isolated root. It did not drive a Memory
  proposal approval: the fixture had no review candidate, target, or model-backed preparation.
  Loaded Findings/Memory integration and review component tests cover the code paths, but are not a
  real-window approval. It also did not drive plugin trust, workflow promotion, or
  native menus, dialogs, and keychain prompts. The driver has no control over those host-owned
  surfaces, and the isolated project had no external provider connection. Do not count them passed.
- Terminal's ordinary WebDriver Enter key arrived in xterm as a private-use character on this host.
  A carriage return delivered the command. The real-window send proof used a temporary observer of
  the Node-owned PTY frames and checked that the marker appeared once as echo and once as output;
  that observer was removed before the session stopped. This establishes simple shell input/output,
  not full native keyboard fidelity for provider TUIs.
- The TUI has no Terminal drawer receiver. Terminal owns the registered session-source projection
  and send action, which are tested, but a visual Terminal session picker and raw PTY input are not
  implemented in this host. [Ticket 07](./07-terminal-client.md) and [tui.md](../../tui.md#what-a-plugin-loses-here)
  now state that boundary explicitly. A host surface and its focus/lifetime contract need a separate
  design; the editor's file PTY is unrelated. A second live node for switching and a real remote
  pairing prompt were not driven in the PTY session; their boot/custody tests passed.
- The development Vite proxy still dropped a cold `/@fs` module response after status in this
  graphical host. Retrying transport before a response did not fix it and was reverted. Agent
  automation now stages the built renderer by default while `--vite` remains available to debug the
  development path. The staged asset path passed real onboarding and project windows; that proof
  does not clear the Vite proxy defect.

## Final gates

The whole-suite wrapper keeps Turborepo at concurrency 6. In this offline worktree,
`pnpm_config_verify_deps_before_run=warn` prevented pnpm 11 from proposing a module purge; no
dependencies were installed. The default sandbox denied localhost listeners, so the full integration
run used host listener permission. Its `EPERM` run was stopped after that cause was clear.

| Gate | Result |
| --- | --- |
| `pnpm lint --env-mode=loose` | Passed, 34/34 tasks, uncached. |
| `pnpm db:check` | Passed, 11/11 fresh migration chains. |
| Architecture, declarations, SDK | Passed: 66/66, 4/4, and 2/2. |
| TUI startup build | Passed: 1,118,096 B/123 eager chunks, under the unchanged 1,130,000 B cap. |
| `git diff --check` | Passed after documentation updates. |
| Exact bounded whole suite after final code | Passed, 35/35 tasks; TUI includes the new recovery test (46 files/589 passed, 2 skipped). |
