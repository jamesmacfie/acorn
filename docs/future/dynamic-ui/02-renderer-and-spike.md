# Phase 2: the renderer and the spike

Status: proposed, 2026-10-01. Revised 2026-10-19 for OpenUI Lang and plans. Depends on
[phase 1](./01-agent-panels.md). The spike's harness and library are throwaway. The renderer package
is kept, private, because phase 3 needs it either way. This phase's output is a measurement recorded
in this file.

## Goal

Answer the question the app half of the programme depends on: for requests a panel can't serve, can an
agent write a useful OpenUI program in one or two tries? Build the Solid renderer first, because the
spike needs it to draw anything, and answer four plumbing questions along the way.

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

Use what ships, phase 1's panel tools, and the renderer package, with a managed Claude session in a
`pnpm dev:agent` window.

1. Define a spike library: the kit components that suit apps, as OpenUI components with Zod schemas
   and descriptions, bound through `@acorn/plugin-api/ui`, plus `Panel` bound to the dashboard views.
2. Give it tools: each app plan as a query tool that runs through the dashboard run route, and
   handlers for `@ToAssistant` and a row-action mutation.
3. Write a guide: the prompt `generateSystemPrompt` builds from the library, the plan instructions
   from `panel_guide`, and four worked examples. Take the example shapes from Lemma's widgets: a table
   you can narrow, one record and its history, a measure beside the records behind it, and a
   checklist that keeps state.
4. Build a throwaway harness: a pane in the dev build that draws a program and its plans from a folder
   and lists their errors, and a script that prints the same errors for the agent.
5. Pick ten prompts from real tasks that a single panel can't serve, for example:
   - "Show the open review comments on this PR grouped by file, with a button to jump to each."
   - "A checklist for this migration's steps that remembers what I ticked."
   - "My open pull requests with failing checks, each with a button that asks you why."
   - "A form that fills in the fields of a Linear issue and puts the text in the composer."
6. For each prompt, the agent writes a program and its plans following the guide. Count the tries
   until the owner calls the result useful, up to three.
7. Record for each attempt: tries, errors by code, the components, props, and functions it wanted and
   could not find, and whether a panel from phase 1 would have done the job after all.

## The four plumbing questions

Answer each with a small proof, not a design:

1. **One renderer, two clients.** Draw the spike's programs in the desktop app and in the terminal
   client, with `@acorn/plugin-api/ui` resolving to each host's kit. Do focus and keyboard work in
   both? Does `Panel` fall back to its one line in the terminal?
2. **Inputs from a program into a plan.** Can a `$` variable, such as a date range the owner picks,
   change what a plan reads through the run route, without the program rewriting the plan?
3. **The Node side.** Parse, validate, evaluate against query defaults, and generate the prompt on the
   Node, without loading any UI. Can `lang-core` build the library's spec from the schemas alone? What
   does it add to the Node service when loaded on the first app tool call?
4. **Client cost.** Measure the size of `lang-core` and the renderer when loaded with the first card,
   against the renderer roster limit in `apps/desktop/scripts/check-renderer-budget.mjs`. Open a
   transcript with ten app cards and record memory and run-route load, on desktop and in the terminal
   client.

## Exit criteria

- **Go** if every conformance case passes, at least seven of ten prompts reach a useful result within
  two tries, and the plumbing questions have answers that do not need a new host primitive.
- **Go with changes** if the misses cluster on a few missing components, functions, or plan inputs.
  List them. Adding them is the first slice of phase 3.
- **Stop** if fewer than five of ten succeed, or most successes could have been a panel from phase 1.
  Then the programme ends at phase 1, and `panel_guide` stays the agent's answer to "show me". See
  [refused](./refused.md#panels-only-with-no-apps). On a stop, delete the renderer package unless
  someone wants to publish it alone.

## Results

Not run.

## Verify before building

- OpenUI's conformance runner, so the package's runner reads the cases the same way.
- That `pnpm dev:agent` works as [local development](../../local-development.md) describes.
