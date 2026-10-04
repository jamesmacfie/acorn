# Phase 05: resolve the keymap dependency branch

Date: 2026-10-04. Status: TODO. Risk: medium to high; keyboard parity is required.
Prerequisite: accepted [phase 04](./04-claude-payload.md). Next: [phase 06](./06-import-cycles.md).
Planning revision: `2ae55abb5`; use the accepted lockfile rather than assuming upstream exports.

## Task and context

Find a supported narrower dependency for Acorn's shared keymap, if one exists. The locked
`@opentui/keymap` 0.5.9 declares `@opentui/core` despite Acorn using its own terminal painter.
The audit found a 24-entry closure, with 18 entries potentially unique to this branch. Those are
lockfile entries, including platform optionals, not proof that the renderer ships or executes.

Preserve a single keyboard behavior across desktop and TUI. This task can finish by retaining the
dependency when narrowing would require a custom engine, unsupported import, or vendor fork.

## Owners and flow

- `packages/client-core/src/host/keys/install.ts` uses the keymap HTML adapter.
- `packages/client-core/src/kit/keys/keymapHost.ts` lends the host to shared components.
- `apps/tui/src/keys/install.ts` registers defaults, enabled fields, and metadata.
- `apps/tui/src/keys/keymapHost.ts`, `commandLayer.ts`, `tiers.ts`, `trap.ts`, and `regions.ts`
  own terminal integration. Acorn's command-layer matching has its own hierarchy semantics.
- `apps/tui/scripts/check-startup-graph.mjs` and `check-runtime-imports.mjs` inspect emitted code.
- Root `package.json` standalone pins/peer rules and `scripts/pack-node.mjs` support Node installation.

Read [shortcuts](../../command-palette-and-shortcuts.md) and [TUI](../../tui.md).
Do not infer runtime removal from an import change: exports can be narrow while installation still
includes a regular dependency. Do not use a package override to delete a dependency it requires.

## Implementation steps

1. Inspect locked package exports and transitive value imports for the main, addons, and HTML entries.
   Distinguish TypeScript types, installed closure, emitted bundles, and executed imports. Run the
   TUI's existing graph checks and record why @opentui/core is present and whether code reaches it.
2. Check primary upstream sources for a supported renderer-independent entry/package or release.
   Record the source, version, API, license, and dependency graph. Do not assume a new package exists.
3. Compare candidate behavior against current registration, chord normalization, focus regions,
   typing protection, collection navigation, command precedence, modal traps, and disposal.
   Keep the current implementation if no supported equivalent exists at reasonable upkeep cost.
4. If a supported candidate exists, adopt the smallest change at the two host installers and their
   typed seam. Preserve public keymap behavior and contribution IDs. Keep Acorn's own command layer.
   Update manifests, lockfile, standalone pin/peer policy, and comments together where necessary.
5. Use existing desktop/TUI keyboard tests to prove parity. Add behavior tests only for actual gaps
   in the candidate, especially input fields, overlapping bindings, modal traps, remount, and cleanup.
6. Build TUI and desktop and inspect emitted graphs. Pack/install the standalone artifact outside
   the checkout under supported Node; prove keyboard startup without Bun or a global dependency.
7. Exercise real desktop and TUI: palette, typing in composer, pane switching, modal Escape, list
   navigation, and collection activation. Use isolated sessions and stop them after inspection.
8. Record either adopted narrowing and measured graph change, or retention with exact constraints
   and a separate follow-up proposal if a fork/replacement ever becomes justified.

## Verification

```sh
pnpm test:focus @acorn/client-core src/host/keys/keys.test.tsx
pnpm test:focus @acorn/tui src/keys/keys.test.tsx
pnpm lint
pnpm test --filter=@acorn/client-core --filter=@acorn/tui --filter=@acorn/desktop
pnpm --filter @acorn/arch-tests test
pnpm --filter @acorn/tui build
pnpm --filter @acorn/desktop build
pnpm pack:node
```

Use `pnpm dev:agent -- --session trim-05` and the desktop UI driver. Use
`pnpm dev:tui:agent -- --session trim-05-tui --fixture tui-navigation` and its PTY driver, including
`resize 120 40`. Full driver commands are in [local development](../../local-development.md).
For a retention-only result, source/graph evidence and a written decision suffice; no code gates are
invented for unchanged code. A narrowed implementation requires all the listed acceptance evidence.

## Acceptance and handoff

A supported replacement/entry ships with parity and independent-install proof, or the current branch
is retained with a precise reason. Correct the TUI manifest's explanation if its dependency claims
are inaccurate. Report direct, locked, emitted, and installed changes separately. Restore manifest,
lockfile, standalone policy, and host installers together if adoption fails. Hand off to phase 06.

## Verify before building

Check live exports, locked versions, package pins, graph checks, and preceding decisions. Stop an
adoption that needs unsupported deep imports, new runtime requirements, or a fork; record retention.
