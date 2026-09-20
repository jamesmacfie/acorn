# Ticket 05: Canonical API representations

Date: 2026-09-21. Status: not started. Prerequisites: 01.
Read [context](./context.md) and F03/F09 in [findings](./findings.md).

## Outcome

Task context, provider credentials, model backend IDs, and notes each have one supported representation.

## Work

- Make TaskContext consist of its task projection and canonical sections. Update remaining readers,
  agent-tool/MCP output consumers, prompts, declarations, and fixtures to section IDs/items. Remove the
  compatibility projection from Notes, GitHub, Memory, and the core linked-item section.
- Remove its separate budgeting/default arrays and response assignment. Retain section ordering,
  omission counts, timeouts, unavailable-source details, and compact formatting.
- Require the credentials object at connection routes. Remove only the top-level token alias; token
  authentication inside a provider's credentials object is valid. Reject obsolete input with a useful 400.
- Require `connection:` or `harness:` model IDs. Remove the bare-ID interpretation and make unknown or
  empty prefixes fail explicitly. Update callers, generated defaults, and stored-format fixtures.
- Remove Memory's Notes routes and bridge methods. Point all owned clients/tools at Notes' routes,
  maintaining the same workspace/device and task-scoped authorization.
- Leave the physical credential column rename for ticket 09 and the `/v1` route change for ticket 10.

## Acceptance

Context pane and generated agent context contain equivalent canonical content for notes, memory,
pull requests, and missing linked items. Responses contain no named compatibility arrays. Old credential
and bare model-ID shapes fail; canonical connect/rotate/generate works. Notes CRUD works only in the
Notes namespace, with unchanged authority checks. Run `pnpm lint`, owning Node/plugin/client tests,
published declaration tests, and task-context/MCP integration checks.

## Verify before building

Search TaskContext consumers by type and property use, not only the word compatibility. Keep
`core.projects.byGithub` and provider codecs, whose live uses are recorded in F09.
