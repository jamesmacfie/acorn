# Phase 05: Linear handoff

Status: planned, October 10, 2026.

Read the [extension context](./README.md) before implementing this phase. It owns the release
boundary, authority model, shared contracts, and defaults.

## Prerequisites

[Browser contributions and GitHub handoff](./04-github-handoff.md). Can proceed independently of
phases 06-08.

## Deliverable

Use the same browser contribution contract to bring a Linear issue into a task conversation with the
correct provider connection.

## Starting point and owners

- `plugins/linear/acorn-plugin.config.mjs` owns loaded declarations and the short/slug URL
  precedent.
- `plugins/linear/src/server/routes/linear.ts` and `plugins/linear/src/server/provider.ts` own issue
  resolution.
- `plugins/linear/src/shared/issueSource.ts` supplies provider-owned task promotion data.

## Implementation steps

1. Declare the issue control and its own Node resolution/context routes in the Linear manifest.
   Handle both short URLs and the issue-title slug form through the shared matcher.

2. Resolve issue identity against connected Linear accounts. Compare the website workspace and
   canonical issue identity, not only the team-prefix identifier. Return all valid connection-bound
   candidates; do not copy the bare-identifier route's first-answer behavior.

3. Use existing external-project mappings to suggest Acorn projects when the provider can establish
   the issue's project/team relationship. Preserve ambiguity rather than guessing from a workspace
   slug.

4. Reuse the shared existing-task and task-promotion flow. Include the connection-bound external
   reference and provider promotion seed; do not create another task endpoint.

5. Supply issue context through the provider route and place it in the draft. Keep chosen-task
   selection separate from silently writing a persistent issue link.

6. Handle an inaccessible/deleted issue, expired credentials, rate limits, multiple candidates, and
   missing DOM anchors with the shared sidebar fallback.

## Demo and acceptance

Hand off short and slug URLs. Use a fixture or test account setup with colliding team prefixes in
two connections and select the correct candidate explicitly.

- Resolve canonical workspace plus identifier, including two connections with the same identifier.
- Verify project/team mapping suggestions, exact existing links, and correct task promotion
  identity.
- Exercise unavailable credentials, deleted issues, rate limits, navigation changes, and missing
  anchors.

## Verify and complete

Run Linear route/provider tests, shared handoff tests, manifest checks, lint, and architecture
checks. Demonstrate a real issue handoff in both browsers.

Complete only when the deliverable and acceptance are demonstrated. Record any failure or
real-browser
verification gap; a build or mocked API alone does not prove browser behavior. Update the owning
reference docs for shipped contracts and add new documentation to both indexes where applicable.

## Scope and stop conditions

Stop at issue handoff and context capture. Do not change the rest of Linear's bare-identifier
navigation, comments, or mutation APIs as part of this phase.

## Verify before building

- Recheck the live owners against the context baseline; prerequisite phases may have moved
  contracts.
- Use the repository's supported runtime, contribution boundaries, and focused test workflow.
- Resolve a prerequisite or contract conflict before adding another implementation path.
