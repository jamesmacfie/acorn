# Ticket 05: Canonical API representations

Date: 2026-09-21. Status: complete, 2026-09-23. Prerequisites: 01.
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

## Delivery record

- Task context now contains only `task` and ordered `sections`. Core tools read section items;
  linked items carry a stable provider ID for filtering, and provider navigation and missing-cache
  details survive assembly. Notes, GitHub, and Memory no longer produce named copies.
- Connection routes require a `credentials` object and reject a top-level `token` with a 400 message.
  Model backend IDs require a nonempty `connection:` or `harness:` prefix, including in stored device
  picks and generation results. The `database:generate` field name remains `connectionId`, but its
  value is a canonical backend ID.
- Memory no longer mounts Notes routes or forwards Notes through its bridge. Notes retains its own
  device gate for workspace/global scope and task confinement for task notes.

Verification: `pnpm lint` passed (34/34). Focused Node integration passed (63/63): task context,
agent tools, route inventory, and Rollbar connect/rotate. Node-core model and auth tests passed
(43/43), MCP projection passed (5/5), protocol backend tests passed (14/14), Memory routes passed
(5/5), Notes routes passed (4/4), Context client/formatter passed (12/12), client model picks passed
(11/11), published declaration contract passed (3/3), and documentation paths passed (3/3).
`git diff --check` passed. The full plugin-types test command remains 3/4 because the generated
manifest schema differs on `showInSwitcher` and `collapsible`; ticket 08 owns that contract. An
unscoped Node test run also hit sandbox loopback `EPERM`; the focused Node suite passed and the MCP
listener test passed with local-listener access.

An isolated Tauri session built and reached a ready Node, but its renderer showed “Acorn could not
start — Importing a module script failed” after Vite reset a loopback connection. The session was
stopped. Context pane and Notes visual behavior remain unverified in a real window.
