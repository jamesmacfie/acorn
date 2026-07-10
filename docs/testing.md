# Testing

The desktop package uses Vitest for unit, route, integration, architecture, and conformance tests.
Run commands from the repository root unless noted otherwise.

| Command | Coverage |
| --- | --- |
| `pnpm lint` | Strict TypeScript (`tsc --noEmit`) across the workspace |
| `pnpm test` | Rebuild native modules for Node, then run the complete Vitest suite |
| `pnpm build` | Build Electron main, preload, and renderer bundles |
| `pnpm --filter @acorn/desktop test:e2e` | Build, rebuild native modules for Electron, and run S1–S5 Playwright-Electron smoke tests |
| `pnpm --filter @acorn/desktop db:check` | Replay the full migration chain on a fresh database |
| `pnpm --filter @acorn/desktop exec electron scripts/smoke-browser.cjs` | Manual drivable-preview smoke against a running Electron app |

## Test layers

- Pure domain tests cover reducers, parsing, config layering, cache codecs, workflow validation,
  profile adapters, and state restoration.
- Route tests mount Hono routers with fake principals and bridge implementations. They verify auth,
  body validation, typed error envelopes, and clean `bridge-unavailable` degradation without
  launching Electron.
- `core/boundaries.test.ts` scans relative imports to enforce app-layer and runtime boundaries and
  freeze the shrinking legacy cross-feature dependency ledger.
- `core/server/integrations/conformance.test.ts` runs every registered provider through capability,
  codec, budget, formatting, and secret-hygiene obligations.
- Startup/restore integration tests prove descriptor order, late registration, persistence arming,
  and scoped eviction.
- The persisted-state and workflow registry conformance suites iterate every descriptor and enforce
  malformed-input tolerance, bounds, unique identity, handlers, and descriptor-owned validation.
- `e2e/desktop.smoke.spec.ts` covers real boot, cross-launch restore, opening a task, terminal echo
  over the authenticated WebSocket, and clean PTY teardown on quit. It uses an environment-gated
  local login and isolated temporary data; the seam returns 404 outside `ACORN_E2E=1`.
- Workflow tests use the committed fake agent through the real argv/template path and cover gates,
  joins, fan-out, branching, cancellation, reconciliation, and tool ceilings.

## Adding tests

Keep tests beside the code they characterize. Prefer a focused pure test when behavior can be
isolated; use route tests for transport and privilege boundaries. A new plugin registry or provider
capability should add a conformance assertion so later contributors inherit the rule automatically.
When a source import crosses an architectural layer, update the implementation to use a contribution
or capability; do not expand the boundary ledger as a convenience.

The test command temporarily builds `better-sqlite3` and `node-pty` for the Node ABI. Run
`pnpm --filter @acorn/desktop electron:rebuild` before launching Electron again.
