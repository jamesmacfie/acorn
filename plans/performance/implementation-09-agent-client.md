# Unit 09: managed agent client ownership and media

Date: October 2, 2026. Implemented from the unit 09 handoff.

## Owners and behavior

The Agents client store captures Node and store generation for roster, delegation, snapshot,
continuation, and session creation reads. Completion checks prevent stale publication and follow-up
reads. Promise cleanup and hold release use their original owner. Deletion during event paging
rejects the read, and the three idle snapshot policy remains intact.

Composer payloads share a Node/session owner, synchronous persistence, hydration, and operation
guards across surfaces. Async operations retain that owner after navigation. Text acknowledgments
check edit revision; attachments and context acknowledgments remove the exact submitted objects
while preserving edits. Offline metadata failure preserves attachment ids for retry.

Legacy drafts are synchronously claimed once for the selected Node. The original keys remain until
storage confirms all scoped fields. Failed storage keeps the payload and claim in memory. No dirty
payload cap or offline mutation replay is introduced. Empty settled drafts release their memory.
Consumed fork drafts retain hydration while the Node advertises pending fork context, preventing
that context from returning on remount.

The Agents media cache shares metadata, full bytes, and data-URL conversion by Node, kind, and id.
Downloads reuse bytes. Active leases survive another consumer's departure. Idle retention is bounded
at 16 MiB of byte arrays plus two bytes per URL character. Raster allowlist and preview limit remain
unchanged. No Blob URL policy changes cross the kit or frame boundary.

The public transport accepts an additive origin/signal option on multipart and byte reads. Uploads
capture origin before File.arrayBuffer. Explicit null never selects an ambient fleet Node.

## Evidence

The audit directory alias for Solid Query selected the wrong entry. The unit fixture uses its
installed ESM entry, deduplicates Solid, and checks provider identity, one ordinary component
construction, and reactive updates. The original transcript parser instrumentation path also moved
on main; the unit probe targets its current rendering owner. Historical artifacts remain intact.

The cumulative before source is HEAD 22cf99cf. The baseline Vite loader reads original source from
Git without changing the checkout. Source hashes are in
[evidence/unit09-before-source-hashes.json](./evidence/unit09-before-source-hashes.json).
Matched before and after runtime manifests record the same harness hashes and provider/runtime paths.
The baseline command sets ACORN_PERF_BASELINE to a JSON map of absolute source paths to the content
returned by git show HEAD:path for the files in that source manifest. The after command omits it.

Eight cards for one 1 MiB image drop from eight metadata reads, byte reads, and conversions to one
each. Logical requested image bytes drop from 8 MiB to 1 MiB. Both trees retain eight image source
attributes totaling 11,185,008 characters. This proves removed reads and conversion work, not heap,
image decoding, renderer CPU, or visible latency.

Matched probes preserve streamed first-card/paragraph identity and full folded ledger reach. Stale
roster and snapshot publication, cross-Node continuation, and hydration into another session fail
in the before owner and pass in the implemented owner. Colocated tests cover deletion while paging,
late cleanup and holds, shared sends/hydration, exact send acknowledgment, native picker origin,
held replacement/upload, legacy quota failure, media separation, retries, and download bytes.

A cost probe also measured 100 actual text input events with two composers and a retained 128 KiB
context. A unified record initially rewrote 13,120,390 characters and took 88.1 ms synchronously,
against 3,380 characters and 19.0 ms before. That design was replaced with separate scoped field
records. The accepted owner writes 1,890 characters in 100 writes instead of 200, taking 19.0 ms.
Process CPU is 32.2 ms against 31.8 ms before. These jsdom samples establish removed writes without
claiming a typing latency gain. The rejected unified-record result remains beside the accepted one.
The final validation run under host load records 39.1 ms and 48.1 ms CPU with the same write counts;
its timings are not paired with the earlier isolated baseline.

The terminal startup graph fails its 1,175,000-byte ceiling before this unit as well: the HEAD
baseline is 1,198,182 bytes, and the measured unit bundle is 1,198,210 bytes. The 28-byte rise is
from the additive transport option. Functional PTY validation uses the built bundle while preserving
this independent gate failure; the ceiling is not raised.

## Verification and limits

- Repository lint passes all 37 tasks. The Agents package type check also passes after the final
  card lease check.
- The bounded repository suite finishes with 36 of 37 package tasks passing. Agents passes 139
  files (971 tests, one skipped); client-core passes 294 files (2,246 tests); Node composition
  passes 280 tests; TUI passes 661 tests with two skipped.
- Desktop passes 149 JavaScript tests and fails six `rendererConnection.test.ts` fixtures because
  `helper.config.watch` is absent. The same failure is documented in
  [the main integration review](./merge-main-review.md). This unit changes no desktop helper or
  fixture source. The desktop boot and Rust stages are not reached in this run.
- The Agents client suite passes 70 files: 380 tests pass and one skips. The final card collision
  regression passes with the other four media tests.
- The cumulative browser probes pass five files and eight tests. Runtime identity and harness hashes
  match the fresh baseline. [Before source hashes](./evidence/unit09-before-source-hashes.json) and
  [after source hashes](./evidence/unit09-after-source-hashes.json) record the owners.
- The staged Tauri window loads the small large-surfaces transcript. Text input enables Send;
  navigating to Home and back restores the unsent draft. The
  [native screenshot](./evidence/unit09-native-draft.png) was visually inspected. The isolated seed's
  session is marked `acorn`/`ready` to enable editing without starting or submitting a provider turn.
  A stale Home element reference failed once after scrolling; a fresh snapshot and retry succeeded.
- The final PTY [navigation report](./evidence/unit09-tui-navigation.json) passes. It includes agent,
  Changes, workspace selection, help, and a 120 × 40 layout. The normal launcher remains blocked
  by the baseline startup graph budget described above; functional validation uses `--no-build`.
- [Disposal evidence](./evidence/unit09-disposal.json) confirms both fixture launchers are absent and
  no matching native app or terminal child remains.

The [repository test log](./evidence/unit09-tests-final.log) and
[lint log](./evidence/unit09-lint-final.log) preserve the final gates. This unit does not complete
units 10–28, two authenticated Node composition, or sustained-use acceptance. Native navigation
does not establish full image decoding cost, cross-Node native custody, or provider send behavior.
Committed command logs remove terminal escape sequences and trailing whitespace;
[log hashes](./evidence/unit09-log-hashes.json) record raw and normalized content.

## Changed owners

- `packages/client-core/src/infra/node/apiClient.ts`: public multipart and byte read options.
- `plugins/agents/src/client/sessions/{managedClient,managedStore,managedDrafts,agentPaneModel}.ts`:
  origin routing, store ownership, draft delegation, and launch completion.
- `plugins/agents/src/client/composer/{AgentComposer.tsx,composerState.ts,composerDraftStorage.ts}`:
  shared operation custody, exact acknowledgement, and durable field storage.
- `plugins/agents/src/client/sessions/{agentMediaStore.ts,AgentAttachmentCard.tsx,AgentArtifactCard.tsx}`:
  shared media leases and a card check against retained resource values from a departed lease.
- Agent Center, commands, and inline diff launchers: resource and completion checks.
- Colocated tests and `unit09-*` probes: deferred races, storage costs, runtime identity, and media.
- API reference, managed client surfaces, and future programme index: shipped contracts and handoff.
  The unit 09 future assignment is deleted.

## Reproduction commands

Commands run from the repository root using Node 26.9.0. The installed pnpm workspace needs
`pnpm_config_verify_deps_before_run=false`; `--env-mode=loose` passes it through Turbo.
Local sockets and the native/PTY drivers run outside the shell sandbox.

```sh
pnpm --filter @acorn/plugin-agents exec vitest run src/client
pnpm lint --env-mode=loose
pnpm test --env-mode=loose
ACORN_PERF_TAG=unit09-accepted pnpm exec vitest run --config plans/performance/unit09-probe.config.ts
ACORN_PERF_BASELINE=/tmp/unit09-before-sources.json ACORN_PERF_TAG=unit09-before-matched pnpm exec vitest run --config plans/performance/unit09-probe.config.ts plans/performance/unit09-store-probe.test.tsx plans/performance/unit09-composer-probe.test.tsx plans/performance/unit09-render-probe.test.tsx plans/performance/unit09-runtime-probe.test.tsx
pnpm dev:agent -- --session perf-agent-client-09 --fixture large-surfaces --profile small --reuse
pnpm dev:agent:ui -- --session perf-agent-client-09 snapshot
pnpm dev:agent:ui -- --session perf-agent-client-09 stop
pnpm dev:tui:agent -- --session perf-agent-client-tui-09 --fixture tui-navigation
pnpm --filter @acorn/tui exec vite build
pnpm --filter @acorn/tui agent:session -- --session perf-agent-client-tui-09 --data-dir "$PWD/.acorn/agent-dev/tui/perf-agent-client-tui-09/data" --no-build --reuse
pnpm dev:tui:agent:flow -- --session perf-agent-client-tui-09 navigation
pnpm dev:tui:agent:ui -- --session perf-agent-client-tui-09 resize 120 40
pnpm dev:tui:agent:ui -- --session perf-agent-client-tui-09 snapshot
pnpm dev:tui:agent:ui -- --session perf-agent-client-tui-09 stop
```

The draft cost baseline runs `unit09-draft-cost-probe.test.tsx` separately with the same baseline
loader and tag `unit09-cost-before-final`. The accepted field run uses tag `unit09-cost-after-fields`.
Other unit09 tags are intermediate runs, retained as superseded evidence. The interrupted final
checks were restarted; their incomplete output is not a passing gate.

For the TUI budget baseline, a temporary Vite config extends `apps/tui/vite.config.ts` with a
pre-load hook using the same Git-source map mechanism. It directs output to
`/tmp/unit09-tui-before-dist`. The baseline command is
`pnpm --filter @acorn/tui exec vite build --config /tmp/unit09-tui-before.config.ts`, followed by
`pnpm --filter @acorn/tui exec node scripts/check-startup-graph.mjs --dist /tmp/unit09-tui-before-dist`.
The loader includes the tracked production files changed by this unit, read from HEAD 22cf99cf.
The [baseline budget log](./evidence/unit09-tui-before-budget.log) and
[unit launcher log](./evidence/unit09-tui-launch.log) preserve both graph failures.
