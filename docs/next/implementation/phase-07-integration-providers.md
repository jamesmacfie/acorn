# Phase 7 — Integration providers and source contributions

**Status:** planned · **Depends on:** Phase 2; benefits from Phases 4 and 5 ·
**Primary docs:** [integrations](../integrations.md),
[contribution-points](../contribution-points.md) §4.2 and §4.14,
[memory](../memory.md).

## Goal

Express Linear and Rollbar through the provider contract before a third
integration exists. The completion test is a Sentry-style dry run that adds a
source, pane, context section, linkifier, and provider behavior without touching
core files.

## Architectural Context

The schema anticipated generic integrations, but code remains provider-specific.
Phase 7 makes provider identity, connection lifecycle, codecs, capabilities,
source promotion, context formatting, mutations, reference resolution, budgets,
and conformance descriptor-driven.

Core owns the connection machinery and lifecycle. Providers own policy,
formatting, auth validation hooks, codecs, and source/pane/link behavior.

## Implementation Plan

1. Provider descriptor registry.

   Add `IntegrationProviderContribution` from [integrations](../integrations.md)
   §1. Activation cross-checks reject source, pane, context, or tool
   contributions naming an unregistered provider id. Replace decrypt-try-skip
   loops with `forEachConnection`. Express Linear and Rollbar as descriptors.

2. Connection model and core-owned connect flow.

   Provider hooks `validate`, `normalize`, `test`, and `summarize` drive one
   connect/store path. Settings render providers from the registry. Add typed
   columns core reads: status, auth kind, last validation time, and account.
   Move `meta` into codec-owned `config`. Add rotation with stable connection
   id.

3. Link identity and write integrity.

   Task-link writes take `connectionId` plus provider ref. Core stamps
   `providerId` from the connection. Add nullable `task_links.refJson` for full
   `ExternalRef`s. Reject provider/connection mismatches.

4. Codecs and context formatters.

   Add per-provider `issues.data` codecs. Validate at read seams. Preserve the
   summary-never-clobbers-detail invariant. Replace cross-provider
   shape-guessing in task context with `LinkContextFormatter`.

5. Source contributions and typed promotion.

   Replace `SOURCE_IDS`, `availableSources`, source switches, and origin glyphs.
   Issue reads become Phase-2 sync descriptors. Promotion uses
   `canPromote`, `prepare`, `create`, and `afterCreate`. Attach-to-current-task
   is a distinct mode.

6. Capabilities, mutations, error taxonomy, lifecycle.

   Capabilities resolve per connection and remain open-ended data. Linear
   comment becomes a declared mutation. Provider errors migrate to the generic
   `provider_*` taxonomy, with client branches updated in the same PR.
   Disconnect, disable, and reauth semantics follow [integrations](../integrations.md)
   §14.

7. Reference resolution, pane intents, and budgets.

   Providers declare link detection/resolution/linkification, pane intents, and
   budgets for concurrency, pagination, cache size, context items, backoff, and
   identifier-resolution batch limits.

8. Memory evidence hooks.

   Providers declare whether linked items, mutations, or triggers may feed memory
   candidates and how evidence is summarized. Providers never write accepted
   memory directly and disconnect never cascade-deletes accepted memories.

9. Integration conformance suite.

   Table-drive the suite from descriptors and run it against Linear and Rollbar.

## Slice Order

1. Descriptor registry and `forEachConnection`, no behavior change.
2. Connect flow and settings rendering.
3. Link integrity and `ExternalRef`.
4. Codecs and context formatters.
5. Source contributions and promotion.
6. Capabilities, mutations, error taxonomy, lifecycle.
7. Reference resolution, pane intents, budgets.
8. Memory evidence hooks.
9. Conformance suite and Sentry dry-run file list.

## Acceptance Criteria

- Linear and Rollbar are descriptors, not hardcoded branches.
- The minimum-contract checklist in [integrations](../integrations.md) §19 is
  ticked.
- A third provider dry run touches zero core files; if it does, the contract is
  incomplete.
- Connection rotation preserves stable connection identity.
- Provider/connection mismatch writes are impossible through core APIs.
- Provider data is parsed through codecs at read seams.
- Summary refresh never clobbers detailed issue fields.
- Provider secrets never reach responses or logs.
- Accepted memory remains human-gated and provider-independent.

## Verification

- `pnpm lint`
- `pnpm test`
- Linear and Rollbar live connect/browse/pane/promote flows unchanged.
- Descriptor conformance suite green for both providers.
- Codec rejection test using old-shape blobs.
- Linear detailed-row refresh preserves description, comments, and activity.
- Provider-specific parity tests:
  - Linear bare-id resolution, explicit integration browsing, workspace project
    links, active-only browse, branch defaults, threaded comments, markdown
    safety;
  - Rollbar stale-cache fallback, counter-string identity, and current-task
    `+task` promotion.
- Sentry dry-run file list proves no core edits.

## References

- [integrations.md](../integrations.md) all sections, especially §1, §3, §5,
  §7-§19.
- [contribution-points.md](../contribution-points.md) §4.2 and §4.14.
- [memory.md](../memory.md) §4, §5, §16.1.
- [security.md](../security.md) §8.
- [feature-parity.md](../feature-parity.md) §6.
- [docs-overhaul.md](../docs-overhaul.md) §3 for `docs/integrations.md`.
