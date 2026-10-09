# Phase 06: Rollbar handoff

Status: planned, October 10, 2026.

Read the [extension context](./README.md) before implementing this phase. It owns the release
boundary, authority model, shared contracts, and defaults.

## Prerequisites

[Browser contributions and GitHub handoff](./04-github-handoff.md). Can proceed independently of
phases 05, 07, and 08.

## Deliverable

Resolve a Rollbar website item into its connection-bound task reference and continue investigation
in an agent conversation.

## Starting point and owners

- `plugins/rollbar/acorn-plugin.config.mjs` owns loaded declarations.
- `plugins/rollbar/src/server/routes/rollbar.ts`, `plugins/rollbar/src/server/provider.ts`, and
  `plugins/rollbar/src/server/index.ts` own provider resolution.
- `plugins/rollbar/src/server/normalize.ts` owns canonical item URLs and privacy-limited error data.

## Implementation steps

1. Declare the item button and plugin-owned Node resolution/context routes. Prove canonical
   `/item/<global-id>/` URLs first, including trailing slashes. Do not infer project counters from
   the URL number.

2. Resolve through authenticated Rollbar connections using the global item ID. Return the actual
   project counter, global ID, and resolving connection. Surface several valid candidates instead of
   selecting the first.

3. Suggest projects using connection/external-project mappings. Keep connection and item identity
   attached through exact-link lookup and task creation.

4. Reuse the handoff/promotion and draft flow from phase 04. Provide normalized error context
   appropriate for investigation, using the provider's allowlisted fields and limits.

5. Preserve credential, inaccessible-item, rate-limit, and partial-failure explanations. Do not pass
   raw occurrence bodies, cookies, headers, or crash-report payloads to the browser.

6. Verify the site insertion anchor and sidebar fallback against the real item view. Additional URL
   forms require fixture-backed provider identity resolution, not loose guessing.

## Demo and acceptance

Hand off a canonical item whose global ID differs from its project counter. Create or choose a task
and inspect the correct connection-bound link and proposed error context.

- Use distinct global IDs and project counters to catch identity substitution.
- Exercise multiple project connections, mapped project suggestions, and inaccessible/expired
  connections.
- Verify normalized context excludes disallowed occurrence fields and respects byte limits.
- Check trailing-slash matching, navigation changes, missing anchors, and sidebar fallback.

## Verify and complete

Run Rollbar normalization/provider/route tests, shared handoff tests, manifest checks, lint, and
architecture checks. Demonstrate a real item in both browsers.

Complete only when the deliverable and acceptance are demonstrated. Record any failure or
real-browser
verification gap; a build or mocked API alone does not prove browser behavior. Update the owning
reference docs for shipped contracts and add new documentation to both indexes where applicable.

## Scope and stop conditions

Stop at item handoff and normalized capture. Do not add error mutations, unrestricted occurrence
export, or a second Rollbar cache.

## Verify before building

- Recheck the live owners against the context baseline; prerequisite phases may have moved
  contracts.
- Use the repository's supported runtime, contribution boundaries, and focused test workflow.
- Resolve a prerequisite or contract conflict before adding another implementation path.
