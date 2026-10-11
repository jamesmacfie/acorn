# Phase 07: project site settings

Status: planned, October 10, 2026.

Read the [extension context](./README.md) before implementing this phase. It owns the release
boundary, authority model, shared contracts, and defaults.

## Prerequisites

[Browser contributions and GitHub handoff](./04-github-handoff.md). Can proceed independently of
phases 05, 06, and 08.

## Deliverable

Persist project/site associations on Node and make sidebar suggestions predictable without moving an
explicitly selected conversation.

## Starting point and owners

- `packages/protocol/src/transport/api/projects.ts` defines project configuration contracts.
- `packages/node-core/src/server/projects/projectConfig.ts` and
  `packages/node-core/src/server/routes/projects/projects.ts` own config read/write behavior.
- `packages/node-core/src/server/db/schema.ts` owns persisted project data. Read [project
  configuration](../../workspaces-and-tasks/project-config.md).

## Implementation steps

1. Add an additive project configuration field for a bounded list of exact HTTP/HTTPS origins and
   optional path prefixes. Default the prefix to `/`; validate credentials, malformed origins, and
   unsupported schemes. Follow normal project change invalidation.

2. Add persistence and a migration only where the project model needs it. Treat absent settings as
   an empty list. Keep them out of committed repo config and preserve unrelated configuration
   fields.

3. Expose narrow native reads/writes and a sidebar editor for adding/removing associations. Display
   association scope separately from browser permission controls.

4. Match cached associations locally against the active site. Combine explicit settings with
   reliable provider/repository suggestions. Show a picker for ambiguity and for unmatched sites.

5. Let the person override the suggestion. Remember that override locally by node and site. Preserve
   an explicitly selected task/session across navigation, and display the changed page relationship
   instead of silently switching it.

6. Handle overlapping path prefixes and several project matches without precedence tricks: they are
   multiple candidates. The association is a suggestion, not a security grant or hard project
   restriction.

7. Offer per-site enable/revoke controls for persistent browser access. On revocation, remove
   injected controls and matching delivery immediately, including controls already injected into an
   open page.

## Demo and acceptance

Associate two different paths on one domain with two projects, then test an overlapping association
and an explicit override. Visit a localhost development URL and confirm the selected conversation
remains bound.

- Verify config round trips, missing settings, migrations, and preservation of unrelated project
  fields.
- Exercise exact origins, ports, path prefixes, localhost, malformed/credential-bearing URLs, and
  several matches.
- Switch nodes/projects/tabs during reads; reject stale settings and keep unsent drafts in their
  original scope.
- Revoke access with an open page; remove its controls without silently requesting broader access.

## Verify and complete

Run project config/routes and migration checks, extension scope tests, affected consumer suites,
lint, and architecture checks. Verify settings follow Node across both browser clients after
independent pairing.

Complete only when the deliverable and acceptance are demonstrated. Record any failure or
real-browser
verification gap; a build or mocked API alone does not prove browser behavior. Update the owning
reference docs for shipped contracts and add new documentation to both indexes where applicable.

## Scope and stop conditions

Stop at associations, suggestions, and an explicit override. Do not build a rule language, hard
project isolation, repo-config inheritance, or shared browser permission grants.

## Verify before building

- Recheck the live owners against the context baseline; prerequisite phases may have moved
  contracts.
- Use the repository's supported runtime, contribution boundaries, and focused test workflow.
- Resolve a prerequisite or contract conflict before adding another implementation path.
