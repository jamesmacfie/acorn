# Command palette phase order

Planned 2026-09-03 against `7d62e3ec`. Status means programme status, not an assignment.

```text
phase 0: baseline + contracts
             |
phase 1: graph + shared session
             |
phase 2: search + input + loaded adapters
          /      \
phase 3: settings  phase 5: loaded plugin adoption
    |
phase 4: compiled plugin adoption
          \      /
          phase 6: cutover + owning docs
```

Phase 4 uses settings from phase 3 for its settings rows, and search/input from phase 2 for everything
else. Phase 5 needs phase 2 but not phase 3 because no initial loaded first-party setting is safe and
simple enough to expose; its fixture proves the public setting descriptor. Phase 6 waits for all
adoption.

| Phase | Priority | Effort | Risk | Depends on | Status |
| --- | --- | --- | --- | --- | --- |
| [0](./phase-0-baseline-and-contract.md) | P1 | M | Medium | — | Shipped |
| [1](./phase-1-command-graph-and-session.md) | P1 | L | High | 0 | Shipped |
| [2](./phase-2-search-and-input.md) | P1 | L | High | 1 | Shipped |
| [3](./phase-3-settings-and-core-commands.md) | P2 | M | Medium | 2 | Shipped |
| [4](./phase-4-compiled-plugin-adoption.md) | P2 | L | Medium | 2, 3 | Shipped |
| [5](./phase-5-loaded-plugin-adoption.md) | P2 | L | High | 2 | Not started |
| [6](./phase-6-cutover-and-documentation.md) | P1 | M | Medium | 3, 4, 5 | Not started |

## Working rules

- Every phase must ship in a usable state; adapters stay until their last consumer migrates.
- Use additive registration before switching callers, and switch all callers before removing an old
  path.
- Run phase-scoped tests after each step, then `pnpm lint`. Run the complete suite at phase exits.
- Do not combine the programme with terminal renderer work, plugin containment, or result action
  panels.
- If a phase discovers that a loaded route cannot enforce the promised task/project ownership, stop
  and repair the ownership design before exposing the command.

## Final gates

```sh
pnpm lint
pnpm --filter @acorn/client-core test
pnpm --filter @acorn/protocol test
pnpm --filter acorn-plugin-types test
pnpm --filter @acorn/tui test
pnpm --filter @acorn/desktop test
pnpm test
```

The desktop command includes staging and Rust tests and is intentionally retained despite its cost.
Use `pnpm test`, not `turbo run test`, for the complete suite so process-spawning tests keep the
repository's bounded concurrency.
