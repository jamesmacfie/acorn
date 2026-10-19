# Phase 0: the renderer and the spike

Status: proposed, 2026-10-01. Revised 2026-10-19 for OpenUI Lang. The spike's harness and library are
throwaway. The renderer package is kept, private, because phase 1 needs it either way. This phase's
output is a measurement recorded in this file.

## Goal

Answer the one question the rest of the programme depends on: can an agent, given a library over the
kit and a few worked examples, write a useful OpenUI program in one or two tries? Build the Solid
renderer first, because the spike needs it to draw anything, and answer three plumbing questions along
the way.

## The renderer package

Build the package [the design](./design.md#the-renderer-package) describes, as a workspace package with
`private: true`:

1. It binds `@openuidev/lang-core` to Solid: the renderer, a store that exposes `$` variables as
   signals, form validation, and action dispatch. The host passes in tools, receives action events,
   and can read and seed the `$` variables.
2. It imports nothing from `@acorn/*`. Add the architecture rule that enforces it.
3. It has no renderer target, so the desktop app and the terminal client each compile it for their
   own renderer.
4. Its tests run OpenUI's conformance cases at both levels, copied from OpenUI's `spec/fixtures/1.0`
   folder with its license: 58 program cases and 12 interaction cases at commit `8d9c4c3`.

**Checkpoint.** Every conformance case passes in the package's own test run.

## The spike

Use only what ships, plus the renderer package: a managed Claude session in a `pnpm dev:agent` window.

1. Define a spike library: the kit components that suit apps, as OpenUI components with Zod schemas
   and descriptions, bound through `@acorn/plugin-api/ui`.
2. Give it tools: a query tool for each data source the prompts need, and handlers for `@ToAssistant`
   and a row-action mutation.
3. Write a guide: the prompt `generateSystemPrompt` builds from the library and tools, plus four
   worked examples. Take the example shapes from Lemma's widgets: a table you can narrow, one record
   and its history, a measure over time, and a checklist that keeps state.
4. Build a throwaway harness: a pane in the dev build that draws a program file and lists its
   `lang-core` errors, and a script that prints the same errors for the agent.
5. Pick ten prompts from real tasks, for example:
   - "Show the open review comments on this PR grouped by file, with a button to jump to each."
   - "A checklist for this migration's steps that remembers what I ticked."
   - "Rollbar errors for this project over the last week, by day."
   - "A form that fills in the fields of a Linear issue and puts the text in the composer."
6. For each prompt, the agent writes a program following the guide. Count the tries until the owner
   calls the result useful, up to three.
7. Record for each attempt: tries, errors by `lang-core` code, the components, props, and functions it
   wanted and could not find, and whether a dashboard panel would have done the job.

## The three plumbing questions

Answer each with a small proof, not a design:

1. **One renderer, two clients.** Draw the spike's programs in the desktop app and in the terminal
   client, with `@acorn/plugin-api/ui` resolving to each host's kit. Do focus and keyboard work in
   both?
2. **The Node side.** Parse, validate, evaluate against query defaults, and generate the prompt on the
   Node, without loading any UI. Can `lang-core` build the library's spec from the schemas alone? What
   does it add to the Node service when loaded on the first app tool call?
3. **Client cost.** Measure the size of `lang-core` and the renderer when loaded with the first card,
   against the renderer roster limit in `apps/desktop/scripts/check-renderer-budget.mjs`. Open a
   transcript with ten cards and record memory and query load, on desktop and in the terminal client.

## Exit criteria

- **Go** if every conformance case passes, at least seven of ten prompts reach a useful result within
  two tries, and the plumbing questions have answers that do not need a new host primitive.
- **Go with changes** if the misses cluster on a few missing components or library functions. List
  them. Adding them is the first slice of phase 1.
- **Stop or rethink** if fewer than five of ten succeed, or most successes are single-source tables and
  charts. In the second case, an agent tool that creates dashboard panels comes first. See
  [refused](./refused.md#dashboard-panels-as-the-only-answer). On a stop, delete the renderer package
  unless someone wants to publish it alone.

## Results

Not run.

## Verify before building

- OpenUI's conformance runner, so the package's runner reads the cases the same way.
- That `pnpm dev:agent` works as [local development](../../local-development.md) describes.
