# Unit 08: shared highlighting and diff presentation

The selected fixes remove duplicate cold workers, obsolete fence dispatch, full overlapping-row
replacement, and quadratic collection scans. They also fence gap reads against pane and file
revisions. These are cumulative changes after units 01–07.

## Owners and contracts

`infra/highlight/documentWorker.ts` owns request settlement and generation checks for two independent,
window-scoped clients. Syntax and word workers keep their engines, wire formats, lazy grammars, and
security policies. A healthy worker survives pane disposal. A single import and construction wave
serves simultaneous calls. Messages, errors, and import continuations remain bound to their captured
generation. Reset settles callers and removes timers before allowing a replacement.

The 10-second deadline includes lazy import. A deadline retires the blocked worker and settles every
request belonging to it. Syntax returns exact plain multiline source, including Unicode and empty
lines. Word diffs omit word marks; complete source rows remain. Later calls to that dead owner also
degrade. The renderer does not synchronously replay that batch. Ordinary worker unavailability,
import, constructor, script, or `postMessage` failure retains the established JavaScript fallback.
A per-document grammar failure keeps a healthy worker usable and falls back for that document.
Neither public client rejects its ordinary failure paths. Diagnostics do not own settlement.

`DiffCanvas` iterates primitive virtualizer keys. Each mounted owner reads current model data,
geometry, and index through reactive accessors. Maps contain only the mounted window. Unified
comment eligibility, target, callbacks, and composer controller remain live. Split scrolling uses
the existing capture listener and adoption owner. File or mode identity still controls genuine
replacement. The focused overlapping composer retains its textarea, draft, and caret when its key
survives a window shift, content refresh, changed geometry, or index movement.

`DiffPane` owns monotonically increasing pane epochs and per-file content revisions. Source, scope,
or file-set changes invalidate the pane epoch, including A-to-B-to-A transitions. A keyed content
refresh invalidates only the files whose keys moved. An unkeyed refresh invalidates all expansions.
Held reads check ownership before tokenization, then check again before publication. Failed reads
leave the gap retryable. Unchanged siblings retain their expanded context and reading position.
The retained row repair also requires exact comment acknowledgement. Submission captures its
controller, raw body, and originating invalidation callback. DiffPane's optional controller
`acknowledge` compares the captured namespace's stored text before clearing; its active-slot cleanup
requires the same source, pane generation, key, and body. Same-key edits during submission, successor
controllers, and changed-source drafts survive. Failed submission keeps the original draft. External
controllers retain a body-equality fallback through the optional seam. No Node API, persisted schema,
content limit, or source custody contract changes.

Markdown checks block liveness after its lazy import and before dispatch. The highlighter shares an
exact language/source promise through grammar loading and HTML rendering. Joining consumers remain
independent: a departed consumer cannot cancel a surviving duplicate. If all consumers depart during
grammar loading, rendering is skipped. Flights leave the map on success or rejection. Completed HTML
retains the 200-entry FIFO and 16,384-UTF-16-code-unit admission limit. Dual themes, sanitization,
source text, and independent copy controls remain.

Collection movement captures one enabled snapshot and resolves active membership once. The normal
zero-argument `active()` contract remains because DOM composition passes it directly to a Solid memo.
The optional `activeIn` resolver lets type-ahead reuse its operation snapshot. In-place disabled
changes, controlled selection, wrapping, page clamping and bubbling, and nested control focus remain
live. No long-lived array-identity cache is introduced.

## Paired evidence

The before snapshot is `/tmp/acorn-perf-unit08-before`; its captured owner hashes are in
[evidence/unit08-before-source-manifest.json](./evidence/unit08-before-source-manifest.json).
`unit08-probe.config.ts` uses the installed explicit ESM query entry and one Solid runtime. The old
report-10 directory-alias config is preserved in `evidence/unit08-audit-probe-config.ts`.
The fresh before run passed the normal provider's actual DiffPane signature/content transitions.
An explicit provider check also constructs one component, captures the supplied QueryClient, and
updates its DOM through a signal. Report-10 browser timings from the earlier alias configuration are
superseded by these cumulative measurements. Independent pure and simulated-worker findings remain
useful characterizations.

Authoritative final after results use `unit08-after-final`; earlier after tags remain intermediate
artifacts. The final source, probe, test, document, and evidence hashes are recorded in
[evidence/unit08-final-source-manifest.json](./evidence/unit08-final-source-manifest.json).
The final exact-acknowledgement guard follows the timed replay. Its source delta is recorded
separately: the timed canvas has no composer, and keyboard/Markdown/gap probes do not submit comments.
Accepted timing artifacts remain intact; final guarded source gets separate regression and lint gates.
Preserved before probe bytes and changed after assertions make the characterization changes
reviewable. The orphan-error case becomes an explicit old-generation/replacement case. No failing
mock or intermediate timing is selected as proof.

| Workload | Before | Final after | Interpretation |
| --- | --- | --- | --- |
| Eight concurrent actual `buildDiffRowsAsync` calls | Eight syntax and eight word constructors; seven survivors per kind after reset | One constructor per kind; zero survivors after reset; identical row counts | Simulated browser workers; removed duplicate owners, not measured browser worker RSS. |
| One ordinary cold file and four sequential warm builds | One worker per kind, no additional warm constructors, five rows | Same counts and rows | Ordinary structural path remains; no startup latency claim. |
| Blocked syntax and word requests | Worker remains eligible; reset leaves two timers until timeout | Both workers retire; reset settles both callers with zero timers; late calls do not post | Fake clock and simulated workers; public client tests prove exact Unicode source and zero synchronous replay. |
| Unified 200-row window shifted by one | Zero of 199 overlapping DOM nodes preserved; CPU 47.125 ms, elapsed 24.893 ms | 199 preserved; CPU 10.842 ms, elapsed 4.723 ms | Actual production canvas in jsdom; selection remains in the old connected row. This is not native interaction latency. |
| Eight simultaneous identical 10,000-character HTML requests | Eight renders, 80,000 source characters | One render, 10,000 source characters | Same exact content and themes; whole-flight joining. |
| Eight replaced 20,011-character fences in one tick | Eight renders, 160,088 characters, 506.574 ms highlight time | One render, 20,011 characters, 66.861 ms | Actual Markdown and Shiki; obsolete work removed. |
| Fence disposed before import resumes | One render, 20,012 characters | Zero renders and characters | Actual Markdown owner; separate real Shiki/copy-control test also passes. |
| 5,000-item near-tail next/page/type-ahead | 25,005,000 / 25,010,000 / 24,955,000 disabled reads | 5,000 each | Actual shared collection owner; one enabled scan per entrypoint. |
| Same 5,000 ordinary items, no counting getter | CPU 297.494 / 298.750 / 295.987 ms | 0.470 / 0.311 / 0.515 ms | Single local process samples; 100- and 1,000-row ordinary lanes remain in the evidence. |
| Late or disposed gap body | Two stale context rows, or one disposed tokenization | Zero stale rows and zero disposed tokenizations | Actual DiffPane with canvas observation seam; lasting tests also cover source/signature/content ABA, held tokenization, sibling preservation, and retry. |

### Costs and limits

A blocked worker loses coloring or word marks for the remainder of its window lifetime. This is the
approved deadline policy; source fidelity remains. Ordinary infrastructure and grammar failures keep
their fallback behavior. The owner adds per-request timer and generation bookkeeping, including the
import interval. Active HTML flights add transient exact keys and liveness closures; they are removed
on completion. No retained-heap or native worker memory measurement is claimed for this unit.

Large changing live fences retain their cost. Four 20,011-character updates render 80,044 source
characters in both versions. Their total highlight time is 299.771 to 328.917 ms; whole-fixture CPU is
849.528 to 1,027.062 ms. Four 80,011-character updates render 320,044 characters in both versions;
highlight time is 1,039.484 to 1,053.215 ms and fixture CPU is 2,289.993 to 2,215.686 ms. These local
samples include jsdom work, allocation, and garbage collection. They show no established performance
gain for settled changing fences. The selected lifecycle repair does not add a degradation threshold,
worker HTML path, streaming parser, or transcript virtualization.

The unchanged completed fence cache is bounded; active work and canonical source are retained for
live consumers. Stable row maps retain the drawn window, not every visited row. No source is
truncated, no dirty draft cap is introduced, and no future plugin or browser capability is assumed.
The future scroll/focus proposal supports retaining semantic identity and custody, which these fixes
preserve. The owning reference is [docs/diff-rendering.md](../../docs/diff-rendering.md).

## Verification

All commands use `rtk proxy` and `pnpm --config.verify-deps-before-run=false`.

- Client affected owners before the final acknowledgement guard: 21 files, 100 tests. The command selects `src/infra/highlight`,
  `src/kit/keys`, both Markdown files, `src/features/diff`, and `src/kit/diff`, with one worker.
- TUI keys and parser: four files, 118 tests. Actual long diff, reachability, and PTY keys:
  three files, 95 tests. The TUI reduced-highlighting contract remains.
- Architecture: five files, 67 tests.
- Repository `pnpm lint`: 34 successful tasks. Client TypeScript also passes separately.
- Final paired owner/DOM/Markdown/gap/provider run: five files, 12 tests. Final collection replay:
  one file, one test. Ordinary baseline replay: one selected case, five skipped characterizations.
- Final acknowledgement/row/gap regression: three files, 12 tests; raw-body/trim-send fidelity,
  failed original draft, same-key edits, successor controller, original invalidation, and captured
  source namespace are covered. This guard is outside timed probe paths.
- `git diff --check` passes. Owning documentation uses its existing indexed page.

The added generic-worker tests cover held imports, deadline settlement, reset, old callbacks after
replacement, import/constructor/script/send failure, and healthy grammar fallback. Public wrapper
tests assert exact multiline Unicode source, plain theme fields, omitted marks, no renderer fallback
calls, zero timers, and no posts after deadline. Unified and split row tests use actual row consumers,
focused textareas, live targets, changed indices/geometry, and split horizontal adoption. Gap tests
invoke actual hydration and expansion. HTML-flight tests hold the grammar seam and prove survivor,
rejection/retry, abandoned work, and oversize completion behavior. A separate actual Markdown/Shiki
fixture proves duplicate live DOM and independent copy controls.

Every worker in the ownership probes is a fixture. Tests terminate their fixtures, dispose DOM roots,
clear query clients, and restore clocks and spies. All accepted command sessions exit successfully.
No native app, PTY, provider, normal profile, branch, or external message is created by this unit.
The coordinator owns rebuilt native interaction checks, final repository tests, and sustained-use
validation. Native latency, browser worker RSS, and day-long stability remain outside these fixture
claims.
