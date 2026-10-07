# Phase 06: documentation

Date: October 7, 2026. Status: planned; implementation not started. Dependencies: phases 02, 03, 04,
and 05.
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
