# Phase 06: documentation

## Completion note, October 8, 2026

Added `docs/frontend/acorn-links.md` as the owning reference for the address grammar, dispatch,
Copy link, task promotion, terminal limits, and developer test recipes. The route-owning plugin
descriptor page explains linkable project pages and the cost of renaming a path. Frontend, terminal,
testing, plugin, and document indexes link to the reference. The phase 01 parser and dispatcher
comments cite its sections. The programme index records six implemented phases and keeps the plan
as a delivery record.

The reference follows the implemented contracts rather than the original examples: a task pane
needs no item, `local` is device-relative, **Add project** targets `workspaces#projects`, and terminal
navigation requires a view registered in that host. Only the release packaging config declares the
scheme. The reference includes desktop and terminal agent recipes; those exercise application
dispatch, not operating-system registration.

Frozen dependencies installed with Node 26.9. Client-core, desktop, and TUI scoped lint passed.
The architecture suite passed 86 of 87 checks. Its sole failure is the three missing generated
Tauri schema paths in the unrelated desktop security design; desktop staging generates them. No
full repository gate or release bundle ran in this phase. Installed-release acceptance remains
unverified: phase 02's three disposable bundle attempts failed during host Rust proc-macro
compilation before an `.app` existed. The live GitHub promotion and loaded-plugin terminal smoke
could not use fixture connections; focused tests cover those contracts. The coordinator should run
the final repository gates and revisit installed delivery when a disposable bundle can build.

Date: October 8, 2026. Status: implemented; installed-release acceptance unverified. Dependencies:
phases 02, 03, 04, and 05.
Read the [plan](./README.md) and [the refused alternatives](./refused.md).

## Deliverable

One reference page that owns the shipped link scheme, links to it from the pages that touch it, and
this folder marked as shipped.

## Steps

1. Write the reference page under `docs/frontend/`, next to rail and routing. Cover the address
   format, which forms are stable, how the Node slot works, the safety rules, and how to test a link
   with `pnpm dev:agent:ui`. Describe what shipped, not this plan.
2. Add a short section to the plugin authoring docs: a plugin page under a project can be linked to
   with no plugin code, and its path is best effort, so renaming it breaks old links.
3. Link the page from `docs/frontend.md`, `docs/tui/process.md` for `--link`, and the content links
   section of the plugin docs.
4. Point the source comments in the phase 01 module at the reference page.
5. Add the page to `docs/README.md`. Mark this programme shipped in `docs/future/README.md`, and move
   its rows in `docs/README.md` out of the future section.

## Acceptance

- `pnpm --filter @acorn/arch-tests test` passes, including the path, citation, and length checks.
- A developer can find the link parser, add a form, and test it from the reference page alone.

## Verify before building

- Which plugin authoring page owns routes, so the new section has one home.
- Whether anything shipped differently from this plan, and record the difference in the reference page.
