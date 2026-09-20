# Ticket 13: Acceptance and documentation

Date: 2026-09-21. Status: implementation acceptance not started; review validation recorded below.
Prerequisites: 01–12.
Read [context](./context.md), [target architecture](./target-architecture.md), and
[reset policy](./reset-and-versioning.md).

## Outcome

The developer can demonstrate one fresh supported baseline, clean plugin ownership, and a recoverable
reset without relying on old data paths. Reference docs describe the shipped behaviour.

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
| Terminal | Fresh custody/cache, same plugin contracts, terminal session selection/send, keyboard scope/focus, node switching, and restart. |
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

## Review validation

This section is evidence for the documentation review, not proof of the proposed implementation:

- Architecture baseline: four files and 63 tests passed.
- `pnpm lint`: passed with existing oxlint warnings; all 34 package tasks were cache hits.
- `pnpm db:check`: all 11 historical chains replayed on temporary databases.
- `pnpm --filter acorn-plugin-types test`: two files, four tests passed.
- `pnpm --filter acorn-plugin-sdk test`: one file, two tests passed.
- Final architecture/documentation suite: four files and 63 tests passed with the programme and indexes
  present. An additional source-path scan found no missing cited files across the 19 programme documents.
- `git diff --check`: passed.
- Product/full-suite/native/UI acceptance: not run for this documentation-only change.

## Verify before building

Check each prerequisite's recorded evidence and re-evaluate changed source citations. Schedule real-host
checks on a graphical machine; do not replace them with screenshots of a browser-only approximation.
