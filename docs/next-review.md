# Post-implementation review — current follow-ups

This replaces the original point-in-time `docs/next` audit. Its high-priority findings have landed:

- repo-authored config/workflows are protected by the hash/diff acknowledgement gate;
- latest-only guards cover session, task-status, and Docker summary refreshes;
- task create/rename errors surface instead of being swallowed;
- the boundary ledger was reduced and remains shrink-only;
- the desktop S1–S6 Playwright smoke suite covers boot, restore, task activation, WebSocket PTY,
  quit cleanup, and search→editor reveal;
- provider, state-slice, workflow-registry, and public-API conformance suites exist;
- GitHub mirror rewrites/pruning and startup orphan repair are explicit;
- startup logs storage footprint and the renderer build has deterministic size budgets;
- completed phase documents were graduated into durable topic docs.

The parent documentation is authoritative for shipped behavior. The remaining work below should be
scheduled by evidence or an explicit product decision, not treated as an unfinished migration.

## Remaining verification

1. Run the live Rollbar contract/privacy checklist in
   [next/rollbar.md](./next/rollbar.md) before expanding provider features.
2. Exercise the Context/Notes slow-response and narrow-layout cases in
   [next/context-ui.md](./next/context-ui.md).
3. Keep preview/browser automation manual QA in release checks: navigation, DevTools isolation,
   kept-alive state, task archive eviction, and agent-driving permission prompts.
4. Validate downloaded DMGs on a clean macOS account, including OAuth, `safeStorage`, migrations,
   unpacked native modules/ripgrep, GUI PATH discovery, and Gatekeeper expectations.

## Measured/deferred engineering work

- **Retention:** SQLite/blob footprint is logged at startup. Add a general age/size sweep when real
  long-lived data demonstrates growth, with mirror/provider/workflow/command classes governed by
  separate policies. Immutable blob cache and app-owned state must never share a blind delete rule.
- **Boundary ledger:** continue replacing existing cross-plugin imports with contribution points
  when nearby; never grow the baseline for convenience.
- **Native SQLite:** reconsider `node:sqlite` only when Drizzle offers a suitable driver or dropping
  `better-sqlite3` removes meaningful complexity. `node-pty` currently preserves the ABI dance
  anyway.
- **Runtime performance:** use boot marks, storage logs, the renderer budget, and targeted large-diff
  captures before creating a general telemetry/benchmark system.

## Open product decisions

- GitHub device flow should replace the OAuth client secret embedded in release binaries before
  broad distribution. See [next/security.md](./next/security.md).
- Chat and Linear evolution remain proposals, not implied roadmap commitments.
- Workflow authoring remains file-only and runs advance only while the app is open. A daemon,
  general DAG editor, or recovery graph needs a separate product/architecture decision.

## Healthy constraints to preserve

- one composition root owns boot order and reverse teardown;
- core owns platform contracts; plugins contribute features; app activates them;
- local GitHub/provider mirrors are disposable, while app state has explicit ownership;
- internal, interactive-user, and public-API principals remain distinct;
- executable repo configuration fails closed until its exact snapshot is trusted;
- privileged path/process inputs are re-derived and validated at the main boundary;
- no raw provider payload or secret is logged, cached in the renderer, or exposed as a generic
  debugging escape hatch.
