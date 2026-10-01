# HTTP decoding, draft custody, and cancellation

Date: October 1, 2026. Status: pending implementation; unit 20.
Assignment: one specialist, run sequentially after coordinator review of the preceding unit.
Prerequisite: Units 01–19, implemented and reviewed in sequence. Paths and findings describe the audit snapshot, not guaranteed merged source.

## Read first

Read [the programme](./README.md), [the implementation contract](./contract.md), and
[the deferred work](./refused.md). Follow the repository engineering guide and the owning runtime
documentation. Trace source, Node API, protocol, broker, cache, and renderer where this assignment
crosses them. Review Git changes since the audit before capturing a fresh cumulative baseline.

The preserved investigations contain the reproducible probes, measured workloads, source paths,
proposed improvements, rejected alternatives, and limits:

- [Investigation 13](../../../plans/performance/13-services.md).

The original [unit brief](../../../plans/performance/implementation-20-review-brief.md) and
[implementation sequence](../../../plans/performance/implementation-plan.md) retain provenance.
The sections below reproduce the detailed assignment so this handoff carries its review concerns.
No application fix for this unit is included in the units 01–08 commit.

## Detailed assignment

Source review on October 1, 2026. Read area 13, docs/http-client.md, and reviewed SDK/tree slot,
Request cancellation, process ownership and host document custody work before implementation.
Take a fresh cumulative baseline; unit 06 may already change HTTP service construction and model
authority. Preserve that captured bridge rather than reintroducing module-global connect().

## Byte decoding

decodeBody currently uses Uint8Array.from(atob(...), callback), which allocates and walks an
iterable per byte. Prefer a feature-detected native byte decoder with a portable indexed-loop
fallback. Keep browser/tree bundles Node-free. Native fromBase64 behavior may differ from atob
for malformed padding, whitespace, alphabets and trailing bits: define and test preservation of
the current accepted/error semantics, rather than accepting a faster decoder with different input
rules accidentally. Return exact bytes and the existing TextDecoder replacement behavior for
malformed UTF-8, empty, binary, BOM and all byte values. No binary bridge/protocol redesign is
selected here. Preserve full response, current 5 MiB streamed cap, truncation/status/header/timeline
metadata, raw/JSON/copy behavior and supported content. ResponseView keeps base64 beside bytes/text;
reduced transient decode allocations are not elimination of those retained representations.

## Draft, selection and acknowledgement

panelModel holds one subject model and publishes save/send completions unconditionally. Capture
bridge/Node authority, subject, request identity, selection generation and submitted edit revision
before awaiting. A completed A response cannot attach to selected B; a save acknowledgement for an
older submitted edit cannot replace new text, change unrelated selection or erase a failed draft.
Serialize writes to the same request and coalesce only genuinely superseded pending edits. New
request creation is single-flight and preserves edits made while awaiting its ID. Preserve full
fields, folder/task filing, curl expansion/import, unsaved new requests and explicitly chosen
copy/delete/save semantics. Dirty recovery lives outside a drawn tree or disposable subject root,
under exact Node/project/task/request identity. Do not cap or fan out sensitive draft data into
unrelated subjects, persist plaintext secrets carelessly, or keep a retired grant alive for retry.
Propose memory/device recovery policy and ambiguous legacy migration before editing.

HTTP variable editors and refreshes share the bridge/subject too. Follow delayed list/save/delete
paths and teardown, preserving last-known rows on failed refresh. Disposal must settle status and
release listeners/resources; it is not an acknowledgement that writes succeeded. Recovery may be
admitted only through newly granted equivalent authority, and must never replay outbound sends.

## End-to-end cancellation

The SDK already accepts AbortSignal on api methods and sends cancel IDs; the host broker receives
a scoped signal. Use that supported seam, then route c.req.raw.signal through send(), secret/task/
variable resolution, core.proc command variables, fetch and readCapped. Unit 02 owns Request
forwarding; unit 10 owns process shutdown. A raw AbortSignal in an ordinary RPC value is not a
serializable cancellation contract. Confirm the actual isolated HTTP plugin and capability path,
not only a stub handler. Combine caller retirement with existing deadlines without resetting the
timeout at each layer. Check abortion after each noncancelable await before admitting more work.

readCapped currently cancels its reader in finally but needs caller retirement while waiting on
body reads. Stop and release exactly once; preserve over-cap versus completed exact-cap distinction
and supported failure taxonomy. Commands for referenced variables run concurrently; cancellation
must retire all owned commands without killing ambient processes or executing overridden commands.
Preserve task/project confinement, device-only route authorization, encryption, secret redaction,
URL scheme validation, broker environment and command/output limits. Cancel does not undo an HTTP
mutation already transmitted, and no retry/replay is authorized by navigation or failed saving.

## Evidence

Paired actual decoder 1 MiB/5 MiB workloads with exact bytes/text, native and fallback paths, CPU
and transient allocation separated. Held send/save/create/list/delete across selection, edits,
subject/Node switch, dispose and warm remount; explicit recovery of failed full drafts. Real
disposable loopback response/header/body waits plus loaded SDK→host→RPC→route cancellation;
synthetic owned command parent/descendants and cleanup counts. No external request, private
credential, paid provider or normal profile is required. Run focused suites/types/lint and owning
docs, coordinate native loaded HTTP response/raw/JSON/copy transitions with the coordinator,
inspect screenshots and stop every fixture. jsdom decoder timings are not WebKit visible latency.

## Completion and handoff

Implement only the reproduced issues within this assignment. Return any explicitly requested
compatibility, migration, or custody proposal to the coordinator before changing that contract.
Use current production owners for paired evidence; preserve historical fixtures and label superseded
baselines. Write an implementation record with changed files, exact commands and outcomes, before
and after comparisons, costs, and concrete remaining limitations. Update the owning shipped docs
when behavior changes. Retire all disposable resources before review. Do not start the next unit.

## Verify before building

- Re-read the merged source and applicable engineering instructions; the audit predates the main merge.
- Confirm prior units' contracts and actual callers still match this proposal.
- Resolve the listed owner, capability, data model, migration, and compatibility decisions before editing.
- Verify a single Solid runtime and normal QueryClient provider for browser measurements.
- Capture fresh source/probe hashes and the same supported workload on both sides of the change.
- Preserve canonical content, offline rows, unsent drafts, and independent Node authority.
- Run relevant tests and types, then coordinate cumulative lint, bounded tests, and real UI checks.
