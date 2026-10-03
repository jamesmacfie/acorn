# Architecture rules

Some tests read source text, the import graph, or the docs instead of running the code. This page
lists those rules and says how each one avoids passing on nothing. Read it before you add a rule or
regenerate a snapshot. Run them with `pnpm --filter @acorn/arch-tests test`.

## Package graph and boundaries

`tools/arch/boundaries.test.ts` scans the package graph for forbidden imports, undeclared
dependencies, cycles, shell bindings outside the shell, impure protocol modules, plugin edges outside
a contract, and route files that cast a request body instead of parsing it.
[Package boundaries](../architecture/packages.md) states the rules.

Four rules read source text instead of the import graph, because what they police is a global, not an
import:

| Rule | Scans | Baseline |
| --- | --- | --- |
| `window.acorn` outside the platform seam | Client source | Shrinking |
| `console.*` outside the client's logger | `packages/client-core/src`, `apps/desktop/src/client`, `apps/desktop/src/shell`, and `apps/tui/src` | Shrinking |
| `console.*` outside the Node's logger | `packages/node-core/src`, `apps/node/src`, `packages/custody/src`, and `apps/desktop/src/helper` | Shrinking |
| `console.*` outside the plugin logger | `plugins/*/src` | Empty |

Each rule also asserts against a few strings the pattern must still recognize, so a regular expression
that stops matching fails instead of passing. The plugin baseline is empty because the exceptions the
other two allow, such as a handshake line on stdout, don't apply to a plugin.
[Telemetry](../telemetry.md) § Logging says why every runtime logs through a logger.

## The closed kit

These rules keep plugins inside the closed component kit. [UI design](../ui-design/closed-kit.md) § The closed kit
describes the kit.

- `tools/arch/primitiveAdoption.test.ts` fails on a raw `div` or `span` anywhere under `plugins/`.
- Two rules in `tools/arch/boundaries.test.ts` fail on a plugin stylesheet and on a plugin that
  imports Solid's `render`.
- A pair of rules scans `plugins/*/src/tree` and `plugins/*/src/client` for raw DOM. A raw element in
  a tree is markup the host can't draw. In a client folder it works in the desktop but is invisible in
  the terminal. Both rules share one definition of raw DOM. The client rule's baseline is empty.

All of these skip `.test.tsx` files and assert that their file lists aren't empty.

The kit invariants read the contract, not the code that implements it:

- `kit/tokens/support.test.ts` checks that the nodes the `/ui` barrel exports and the rows in
  `NODE_SUPPORT` are the same list, each with a terminal support level.
- `kit/tokens/roles.test.ts` checks that every role token has a value on both hosts, and that the DOM
  value names a token `tokenAxes.ts` declares.
- `kit/tokens/props.test-d.ts` is a type-level test that no node's props accept `class`, `className`,
  `style`, or an arbitrary string where a role belongs. `tsc --noEmit` under `pnpm lint` runs it.
- `kit/tokens/hover.test.ts` reads the stylesheets. A rule that reveals something on `:hover` has to
  reveal it on `:focus-within` too. jsdom computes no styles, so only a stylesheet scan can check this.

These paths are under `packages/client-core/src/`.

## Loadability

Two rules about whether the workspace boots are checked by loading the code:

- `packages/plugin-api/src/entrypoints.test.ts` imports every Node-safe facade entrypoint in a
  Node-environment Vitest worker, the same shape a plugin's own suite runs in.
- The composition-root suites under `apps/node/test/integration/` boot every plugin's `node/index.ts`.

The architecture suite's text checks are a fast first line. Neither keeps a file allowlist.

## Doc checks

`tools/arch/docPaths.test.ts` reads `docs/`, `README.md`, and `AGENTS.md`:

- A repository-rooted path in backticks has to exist. A path with no file extension is skipped,
  because directories move for reasons that aren't rot.
- A relative link between docs has to resolve, including its `#fragment`.
- A path is skipped when its own line says the file is gone or hasn't arrived, such as "deleted",
  "moved to", or "in git history".
- Four directory names may appear only on a line that marks them gone, like this one:
  `src/main/`, `src/app/`, `src/wiring/`, and `src/service/` were deleted.

`tools/arch/docCitations.test.ts` reads the other direction: source files under `apps/`,
`packages/`, `plugins/`, `tools/`, and `scripts/` that cite a doc.

- Every `docs/<page>.md` they name has to exist, with no exceptions.
- Every `§ Heading` after one has to start with a heading or an explicit anchor in that doc, after
  wrapped comment lines are joined.
- Section citations that failed when the check landed sit in
  `tools/arch/docCitations.allowlist.txt`. An entry that starts passing fails the test until you
  delete it, so the list only shrinks.
- The same file prints the docs longer than 200 lines as a report. It doesn't fail on them.

The check reads tracked files only, so run `git add` on a new file before you trust a pass. Vitest
hides `console.info` from passing tests when it detects an agent. To see the length report, run
`env -u CLAUDECODE npx vitest run docCitations` in `tools/arch`.

## Non-vacuity

A test that asserts source shape or route mounting must fail when the behavior is removed. Boundary
and parity tests include explicit graph and literal checks. Source-text tests strip comments before
they match implementation calls.

Snapshot-backed lists need extra care, because a file you can regenerate can hide a regression.
`packages/plugin-api/src/surface.snapshot.txt` and the four plugin golden lists
([plugins](../plugins.md) § The golden lists) are compared for exact equality, never a subset. A
contribution that disappears fails as loudly as one that appears. Each list has a hand-written floor
beside it, because an exact match against an empty snapshot would pass. Regeneration sits behind an
environment variable, and the diff is what you review.

The facade snapshot goes further, because it's a published contract. Its first line records the
`PLUGIN_API_MAJOR` it was written under. `UPDATE_SURFACE=1` refuses to write a snapshot that has lost
a name while that major is unchanged. Adding a name is free. Removing one means raising the major,
which every plugin package's `apiVersion` range is checked against.

`UPDATE_PLUGIN_SCHEMA=1` rewrites the manifest JSON Schema from the Zod contract, in
`packages/plugin-types/src/pluginSchema.test.ts`. The same file's assertion keeps the published
schema and the contract in step.
