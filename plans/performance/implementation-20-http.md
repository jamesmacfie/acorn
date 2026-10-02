# HTTP decoding, draft recovery, and cancellation implementation

Date: October 2, 2026. Unit 20 is implemented. Native acceptance remains blocked by the Node service bundle budget.

## Owners and decisions

Admission source is commit `4d8f99daf`, with concurrent uncommitted editor work. The admission hashes
are in `unit20-admission-hashes.json`. The captured bridge model from unit 06 remains intact.
No protocol, schema, encryption, capability, or device authorization changes are required.

The client runs in the loaded HTTP tree worker. Its region leases capture immutable host authority.
The client API goes through SDK cancel IDs and the host broker to a portable Request in the isolated
Node worker. That worker resolves task/project/secret data and delegates command variables to the
host's `core.proc` owner. Fetch and streamed response reads remain in the HTTP plugin.

The recovery policy was stated before implementation: full drafts remain in worker memory outside
disposable Solid roots, under exact Node/authority/project/task/request identity. Unsaved requests
get independent identities and explicit recovery entries. Recovery requires a mounted equivalent
grant and never replays sends. No plaintext device persistence, size cap, or count cap was added.
Ambiguous legacy `http-draft:*` keys remain swept because they cannot establish that identity.

## Changes

- `httpClient.ts` validates the HTML forgiving-base64 input rules before using native
  `Uint8Array.fromBase64`. Its portable fallback uses an indexed loop. Both preserve classic
  alphabet validation, whitespace, optional padding, loose trailing bits, exact bytes, UTF-8
  replacement, and BOM behavior. The browser bundle has no Node decoder dependency.
- `panelModel.ts` owns equivalent region leases. `requestModel.ts` owns revision and selection
  admission, full draft recovery, and per-origin retirement. `draftRecovery.ts` holds memory without
  bridges; `requestGroups.ts` owns folder projection without a model dependency cycle.
- Saves and deletes run in order, including separate project/task models editing the same Node
  request. New request creation waits for one ID before queued saves update it. Queued retired
  writes settle without running. Each job still uses its own captured authority and payload.
- Save acknowledgements advance their submitted baseline without replacing later edits or changing
  another selection. Failed and retired saves retain full drafts. Explicit deletion discards the
  submitted draft; text entered during deletion remains an unsaved recovery. The list exposes
  **Recover unsaved edits**. Copy, filing, task execution context, and curl behavior are preserved.
- `variableModel.ts` retains full variable drafts outside the drawn editor, reconciles acknowledgements
  by identity/revision, captures project and client authority, and retires held operations on project
  change or disposal. `httpWrites.ts` orders HTTP record writes without joining draft state or grants.
  Failed request and variable refreshes retain last-known rows.
- Send uses the supported SDK signal option. Selection changes, replacement sends, and origin
  retirement cancel it. The route forwards `c.req.raw.signal`; `send.ts` combines caller retirement
  with one 30-second deadline covering resolution, fetch, and body reads. Commands share cancellation,
  retain their 15-second/output limits, and settle as a group. Overridden commands never execute.
- `responseBody.ts` owns the capped reader. Cancellation stops it once and releases its lock, even
  when underlying stream cleanup does not settle. Exactly 5 MiB completed is distinct from over-cap.
  Full response/status/header/timeline data and raw/JSON/copy behavior remain supported.
- `docs/http-client.md` owns the shipped contracts. The pending unit markdown is deleted and the
  programme index links to this record.

## Matched decoder evidence

`unit20-decoder-before.ts` preserves the production decoder at admission. The probe selects that
snapshot for before tags and the production owner for after tags. `unit20-decode-before.json`
preserves the first Node 24 sample; comparison uses the matched Node 26.8.1 records in
`unit20-decode-before-native.json` and `unit20-decode-after-native.json`. The before decoder ignores
native availability; both before modes use its iterable implementation.

| Workload | Before elapsed | After native elapsed | After fallback elapsed | Before CPU / native after / fallback after |
| --- | --- | --- | --- | --- |
| 1 MiB, all byte values | 47.34 / 46.70 ms | 4.71 ms | 8.17 ms | 48.48 / 5.08 / 11.99 ms |
| 5 MiB, all byte values | 255.57 / 249.24 ms | 23.33 ms | 30.56 ms | 272.28 / 25.30 / 34.74 ms |

Every workload returns exact bytes and the same TextDecoder output. At 5 MiB, sampled transient
heap growth is about 97.4 MB before, 10.5 MB native after, and 15.7 MB fallback after. Array-buffer
growth remains about 5.24 MB. These are single-run V8 CPU/elapsed/transient-allocation samples,
not retained-memory measurements, statistical distributions, or WebKit visible latency. Base64,
bytes, and text still remain resident in the response view. Dirty recovery also deliberately retains
full unsent content; this unit does not claim bounded total draft memory.

Commands, with the installed supported Node 26.8.1 bin directory first in `PATH`:

```sh
rtk proxy node --expose-gc --import tsx plans/performance/unit20-decode-probe.mjs before-native
rtk proxy node --expose-gc --import tsx plans/performance/unit20-decode-probe.mjs after-native
rtk proxy pnpm --filter @acorn/plugin-http test
rtk proxy pnpm --filter @acorn/plugin-http lint
rtk proxy pnpm exec vitest run --config plans/performance/unit20-loaded-probe.config.ts
rtk proxy pnpm lint
rtk proxy pnpm --filter @acorn/arch-tests exec vitest run docPaths.test.ts boundaries.test.ts
rtk proxy pnpm dev:agent -- --session unit20-http
rtk proxy pnpm dev:agent:ui -- --session unit20-http stop
```

## Verification and limits

The focused HTTP suite passes 148 tests across 14 files. Added regressions cover malformed base64
and both decoder paths, full failed drafts, selection/Node/grant transitions, root eviction and warm
remount, old acknowledgements, single-flight creation, ordered writes, queued-origin retirement,
held list/save/delete paths, secret variable drafts, real loopback header/body waits, and exact-cap
versus over-cap bodies. A held noncancelable task lookup cannot admit later work after retirement.
Type checking passes. Full repository lint passes all 37 tasks. Architecture and documentation checks
pass 59 tests across two files. `unit20-source-hashes.json` captures the final owners, shared
cancellation dependencies, fixtures, configurations, and evidence hashes.

`unit20-loaded-after.json` records the actual SDK MessageChannel → host broker → loaded,
permission-scoped worker RPC → portable HTTP route path. Real loopback header and body waits close
after cancellation. Two real command variables start two parents and two descendants; all four
PIDs retire, and the overridden command creates no marker. The probe uses a disposable SQLite
root and checkout and disposes the worker, ports, listeners, sockets, and processes. The host service
adapts the device HTTPS transport to the loaded route, so this does not measure that network hop.

Initial loopback tests failed with sandbox `listen EPERM`; the authorized loopback run passed.
The first loaded probe used Node 24.11.0 and was refused by the patched-runtime gate. It passed on
the installed Node 26.8.1 runtime. An initial lint run found a fixture type error, which was corrected.
The later write-queue verification caught an abort listener registration error; correction passes
the full focused suite. These failures are fixture/implementation history, not speedup evidence.

The Tauri launcher failed during asset staging: the static service graph is 3,076,898 bytes against
the 3,062,000-byte ceiling. HTTP is loaded separately and is not part of that compiled graph.
No window launched, no screenshot was produced, and `stop` confirms the session is not running.
Native loaded HTTP recovery, response/raw/JSON/copy transitions, visible timing, and sustained use
remain acceptance work after the service budget gate is resolved. No budget bypass was added.

Worker eviction, plugin replacement, and application exit still lose unsaved memory. Cancellation
does not undo transmitted HTTP mutations or prove a retired save did not reach storage. Recovery
therefore does not retry writes automatically. Draft ordering applies within the shared worker;
independent devices can still explicitly edit the same server record without optimistic concurrency.
No whole-repository test-suite or sustained-use claim is made by this unit.
