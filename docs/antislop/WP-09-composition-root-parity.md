# WP-09 — Composition-root dedup + structural parity (F9)

**Effort:** M · **Depends on:** WP-08 — unifying late binding changes what the roots assemble;
dedup done first would be rewritten.

## Context — finding 9, docs/analysis.md

Two composition roots build the same Node service graph:

- `apps/node/src/service/runtime.ts` (~308 lines) + `apps/node/src/server/pluginDeps.ts` (~71) —
  the standalone Node host.
- `apps/desktop/src/app/main/serviceHost.ts` (~152) — the Electron-supervised host.

They duplicate a ~50-line deps bag, the reconcile sequence, and the shutdown drain list. The
guard is `standaloneParity.test.ts` (in `apps/node/test/integration/`) plus
`apps/desktop/test/client/parity.test.ts` — but the parity check scans for only ~5 source-text
needles, so a divergence that avoids those needles ships silently. Boot order itself is owned by
`apps/desktop/src/app/main/bootstrap.ts` (repo memory: the composition root owns boot order +
teardown; also noted in `docs/analysis.md` deferred list: bootstrap.ts has no test).

## Pre-flight

```sh
wc -l apps/node/src/service/runtime.ts apps/node/src/server/pluginDeps.ts \
      apps/desktop/src/app/main/serviceHost.ts
grep -rn 'needle\|includes(' apps/node/test/integration/standaloneParity.test.ts | head
diff <(grep -o '[a-zA-Z]*:' apps/node/src/server/pluginDeps.ts) \
     <(grep -o '[a-zA-Z]*:' apps/desktop/src/app/main/serviceHost.ts) | head -30
```

Confirm the duplication survived WP-08 (which dissolves `apps/node/src/wiring/` and may already
have shrunk both roots). Amend scope to what remains.

## End state

- One shared assembly function (deps bag construction, reconcile sequence, drain list) that both
  roots call with their host-specific capabilities injected. Home: `packages/node-core` — it is
  node-side service assembly, and both apps already depend on node-core. **Boundary check:** apps
  may import core freely, but the shared assembly must not import Electron or anything
  app-specific; host differences arrive as parameters.
- Each root keeps only what is genuinely host-specific (Electron supervision/safeStorage vs
  standalone signal handling/env).
- The needle-scan parity tests replaced by a structural test: both roots produce the same service
  graph (same registered plugin set, same drain order, same capability provisions) by executing
  the shared assembly, not by grepping source text.

## Non-goals

- No behavior change to boot order or teardown semantics — `bootstrap.ts` still owns sequencing.
- No merging the two apps or their host-specific capabilities.
- Not adding the deferred `bootstrap.ts` test unless it falls out naturally (record if skipped).

## Slices (one commit each)

1. **Characterize.** Extend the integration suite to snapshot the assembled graph of the
   standalone root (plugin ids, drain order) — the before/after proof.
2. **Extract.** Move the shared assembly into node-core; standalone root consumes it. Snapshot
   unchanged.
3. **Desktop root consumes it.** The duplicated bag/sequence/drain in `serviceHost.ts` deleted.
4. **Structural parity test** replaces the needle scans; delete the needle assertions (keep the
   files if they host other checks).

## Gates

Per slice: `pnpm --filter @acorn/node test` (integration suite boots the real root),
`pnpm --filter @acorn/node-core test`, `pnpm lint`. Slices 3–4: desktop e2e — it is the only
automated check that the Electron-supervised root actually boots
(`pnpm --filter @acorn/desktop test:e2e`, rebuilds the Node artifact first).

## Risks & rollback

- **Silent divergence inversion:** the risk of extraction is a host difference that was
  load-bearing (e.g. desktop reconciles later because the window must exist). Slice 1's snapshot
  plus a careful read of `bootstrap.ts` ordering comments before slice 3 is the control.
- **Drain-order changes** manifest as flaky shutdown, not test failures — keep drain order
  byte-identical in the extraction; any reorder is out of scope.
- Slices 2 and 3 are independent substitutions; each reverts alone.

## Doc updates

`docs/electron.md` (main-process composition) and `docs/node-distribution.md` (standalone
composition) — with slice 3. `docs/testing.md` if the parity-test story changes — with slice 4.

## Done criteria

- [ ] Shared assembly in node-core; no Electron import in it (arch tests prove this).
- [ ] Deps bag / reconcile / drain appear once in the codebase.
- [ ] Structural parity test in place; needle scans gone.
- [ ] Integration + e2e green; user QA note: app boots, node child restarts after kill (crash
      budget behavior unchanged).

## Progress

- [ ] Slice 1 — graph snapshot
- [ ] Slice 2 — extraction + standalone
- [ ] Slice 3 — desktop root
- [ ] Slice 4 — structural parity
