# 08 — Enforce the loadability properties, not their symptoms

**Strength: Strong on evidence, small in scope. A near-miss is already sitting in the tree.**

## The problem, plainly

Two rules keep this codebase bootable, and every plugin author is expected to know both:

1. A node-environment test must be able to import `@acorn/plugin-api/client` — so nothing on that
   barrel may reach a `.tsx` file, because Solid compiles components to code that touches `window`
   at module scope.
2. The standalone (Electron-free) node must be able to import every plugin's `main/` entry — so no
   static `import from 'electron'` may be reachable from those barrels.

Both rules are real, both have bitten before, and both are enforced one level shallower than the
property actually holds: by pattern-matching import specifiers and by hand-maintained file
allowlists, instead of by loading the things and seeing if they load. The result is that the tests
pass while the property is already (or about to be) false.

## What happens today

**The barrel rule has a live near-miss.** The enforcement,
`tools/arch/boundaries.test.ts:536-561`, greps entrypoint files for *direct* `.tsx` specifiers.
But the property is transitive, and `/client` already reaches a `.tsx` file through two hops:

```
packages/plugin-api/src/client/index.ts        (exports createOverlayPalette, line ~177)
  -> @acorn/client-core/palette/overlay.ts
    -> ../registries/keybindings                (a VALUE import)
      -> packages/client-core/src/registries/keybindings.tsx
```

It survives only by accident: `keybindings.tsx` is 190 lines with a `.tsx` extension and **no JSX
in it today**. The moment anyone adds a component to that file, every node-environment test that
imports `/client` breaks — and no rule fires, because the direct specifiers all still point at
`.ts` files. Meanwhile the property has zero consumer coverage from the other side: across all
plugin tests, imports of `@acorn/plugin-api/client` number exactly zero (the seven client-side
plugin tests deep-import client-core paths instead — see file 03).

**The electron rule already produced the failure it exists to prevent.** `docs/testing.md:50-53`
documents two environmentally-failing integration tests whose root cause was a static electron
import reachable through the terminal plugin's main barrel; the fix was a lazy `createRequire` in
the one file that got caught (`plugins/terminal/src/main/folderPickerIpc.ts`), with the rule
restated in a comment on the barrel. The enforcement that remains is a file allowlist —
`tools/arch/boundaries.test.ts:510-522`:

```ts
const ELECTRON_OK_OUTSIDE_DESKTOP = new Set([
  'plugins/terminal/src/main/folderPickerIpc.ts',
  'plugins/preview/src/main/previewService.ts',
  'plugins/preview/src/main/browserService.ts',
])
```

This checks *which files* import electron, not *whether the standalone node can boot*.
`plugins/preview/src/main/previewService.ts:3` has a static
`import { BrowserWindow, ipcMain, … } from 'electron'` and is re-exported from preview's main
barrel. It passes today only because that barrel is desktop-only right now; one innocent
`import '@acorn/plugin-preview/main/index.ts'` added on the node side makes the standalone node
unbootable — and the allowlist test still passes, because those files are allowlisted.

## Why it matters, simply

Rules that live in comments and memory fail on whoever wasn't there when the rule was made — and
they fail far from the cause, as a confusing crash in someone else's test run. A rule that is a
test fails at the commit that breaks it, with the import chain in the stack trace. Execution is
the honest check for an evaluation property: if the claim is "this module loads in plain Node",
the test is to load it in plain Node.

## The change

Two small node-environment test files; retire the two pattern checks into them.

1. **Load the facade entrypoints.** A test (natural home: `packages/plugin-api`, beside
   `surface.test.ts`) that does `await import('@acorn/plugin-api/client')`, and the same for
   `/node`, `/ui/diff`, `/ui/sdk`, `/ui/editor` — every entrypoint that claims to be
   node-environment-safe. (`/ui` and `/ui/host` are the two that legitimately reach components;
   they stay out.) If it imports, the property holds; if someone adds JSX to
   `keybindings.tsx`, this fails with the real chain.
2. **Load every plugin main barrel in plain Node.** A test that globs `plugins/*/src/main/index.ts`
   and imports each. The glob matters: it covers the next plugin automatically, which is the
   difference between a property and an allowlist. Preview's static electron imports will fail it
   on day one — that is the test doing its job; give them the same lazy `createRequire` treatment
   terminal got.
3. **Retire the allowlists.** `ELECTRON_OK_OUTSIDE_DESKTOP` and the direct-specifier `.tsx` grep
   can then shrink to a comment pointing at the execution tests, or stay as a fast first line —
   but they stop being the only line.

## Notes for whoever picks this up

- The import test must run under the same conditions plugin tests do: vitest, `environment:
  'node'`, no Solid transform, no jsdom. That configuration is the point — it is exactly the
  environment the property protects.
- Watch for module-scope side effects: some barrels may run registration code on import. If any
  entrypoint does real work at module scope, that's a finding in itself (the facade is declared
  side-effect-free in its package.json — the test doubles as enforcement of that claim).
- Expected first failures: preview's `previewService.ts`/`browserService.ts` (static electron).
  Fix pattern is in `plugins/terminal/src/main/folderPickerIpc.ts:1,14` — a lazy
  `createRequire(import.meta.url)('electron')` behind a function.
- Also consider fixing the near-miss directly while you're there: `registries/keybindings.tsx`
  contains no JSX, so renaming it to `.ts` both removes the accident and lets the existing grep
  rule mean what it says. The execution test is still the durable fix.
- Cheap, contained, test-only. No wire changes, no plugin API changes.
