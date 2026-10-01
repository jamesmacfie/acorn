# Managed agent client reads, draft custody, and media

Date: October 1, 2026. Status: pending implementation; unit 09.
Assignment: one specialist, run sequentially after coordinator review of the preceding unit.
Prerequisite: Reviewed units 01–08. Paths and findings describe the audit snapshot, not guaranteed merged source.

## Read first

Read [the programme](./README.md), [the implementation contract](./contract.md), and
[the deferred work](./refused.md). Follow the repository engineering guide and the owning runtime
documentation. Trace source, Node API, protocol, broker, cache, and renderer where this assignment
crosses them. Review Git changes since the audit before capturing a fresh cumulative baseline.

The preserved investigations contain the reproducible probes, measured workloads, source paths,
proposed improvements, rejected alternatives, and limits:

- [Investigation 08](../../../plans/performance/08-agent-client.md).

The original [unit brief](../../../plans/performance/implementation-09-review-brief.md) and
[implementation sequence](../../../plans/performance/implementation-plan.md) retain provenance.
The sections below reproduce the detailed assignment so this handoff carries its review concerns.
No application fix for this unit is included in the units 01–08 commit.

## Detailed assignment

Browser fixture prerequisite: verify or correct report 08's directory alias for
`@tanstack/solid-query` before fresh cumulative measurements. It can resolve CommonJS and a second
Solid runtime. Keep old artifacts and record matching ESM provider/runtime identity, ordinary
reactive component construction, and harness hashes before accepting ownership or DOM comparisons.

Source review on October 1, 2026. This supplements report 08. Start after unit 08 is reviewed.
Preserve streamed card/paragraph identity, complete paged ledger reach, usage unions and the three
idle-snapshot policy. This unit repairs the Agents client owners; Node execution and search belong
to later units.

## Session reads

Capture Node and store generation before roster, snapshot, event-page, delegation and prime reads.
Every continuation page stays on the captured Node. Check ownership after each await and before
publication, indexing, completeness, recency or follow-up reads. Cancellation does not replace
these checks. Identity-guard promise-map cleanup and snapshot trimming so a late A `finally` cannot
affect B. Check deletion during paging as well as Node changes, and prevent a deleted session from
reappearing. Include Agent Center resource reads and start-session completions outside the store.

Use generation-owned hold releases if clearing their map. Existing hold arithmetic is correct;
late A cleanup must not decrement B with the same session ID. Same-Node concurrent readers still
share work and resumed reads preserve folded sequence reach and canonical completeness.

## Draft custody

Capture Node, session, exact shared draft state, durable keys and operation/edit revisions before
hydration, upload, replacement, context capture and send awaits. Complete and release guards on
that captured draft. Both surfaces of one session share hydration and operation guards. A successful
send acknowledges the submitted draft, not edits made afterward or another visible session.
Returning to either Node restores its unsent payload. Deletion clears only the correct owned draft.

Capture upload origin before `File.arrayBuffer()` and before a native picker resolves. The current
`managedClient.uploadAttachment` awaits bytes before `sendForm` selects ambient Node, and `sendForm`
has no explicit origin option. Use the public typed transport seam for an additive origin/signal
option if needed; preserve multipart custody and avoid a private core import. Explicit null means
the serving origin and must not fall back to the active fleet Node. Native picker completion may
retain origin-owned draft work, but cannot silently attach it to a newly selected session.

Return the legacy migration policy before editing durable keys. Generic device-local task text
conventions remain separate: agent drafts contain Node-owned attachment IDs and context. A
synchronous, once-only claim of legacy payload for the selected Node may be appropriate, preserving
the original until the new record is safely written. Never fan ambiguous attachment IDs into every
Node or erase a legacy draft after a failed storage write. Preserve supported unsent work without
an arbitrary dirty cap. Reap disposable empty/settled memory where safe, with exact acknowledgements
and fallback when local storage fails. No offline mutation replay is implied.

## Media

Share in-flight metadata, bytes and data-URL conversion through an Agents-owned Node/kind/ID cache.
Bound idle retained bytes and release settled failures; active consumers hold their entry. Downloads
reuse held full bytes and keep exact type/filename behavior. Validate the existing image allowlist,
separate artifacts from attachments, and prevent late old-Node results entering a replacement entry.
One departing consumer must not cancel another's shared read.

Keep data URLs initially unless a separate supported media seam is justified. The Markdown parser
does not accept `blob:` and loaded frames have stricter image policy; do not broaden those policies
incidentally. Repeated source attributes and DOM/parser work may remain even after one conversion,
so distinguish requests/converted bytes from DOM strings, heap and rendering claims.

Use fresh cumulative actual store/composer/media owner probes before edits. Add deferred colliding
IDs, deletion, paging, exact send ack, held upload/replacement, legacy storage failure and two-surface
guard tests. Verify eight identical cards share one read/conversion and final release meets the
chosen idle byte policy, while distinct images and full downloads remain correct. Run relevant
client/kit/host tests, types/lint and owning docs. The coordinator owns native navigation and the
final sustained-use and repository gates.

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
