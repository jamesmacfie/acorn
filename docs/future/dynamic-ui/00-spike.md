# Phase 0: the spike

Status: proposed, 2026-10-01. Throwaway work. Nothing from this phase ships, and its output is a
measurement recorded in this file.

## Goal

Answer the one question the rest of the programme depends on: can an agent, given the kit vocabulary
and a few worked examples, write a useful tree in one or two tries? Answer three plumbing questions
along the way.

## Method

Use only what ships: the scaffold's plain-JavaScript tree, dev mode, `plugin_authoring`, and a managed
Claude session in a `pnpm dev:agent` window.

1. Hand-write a short authoring note: the kit components that suit apps, their properties, the bridge
   calls for data sources, and four worked examples. Take the example shapes from Lemma's widgets: a
   table you can narrow, one record and its history, a measure over time, and a checklist that keeps
   state.
2. Pick ten prompts from real tasks, for example:
   - "Show the open review comments on this PR grouped by file, with a button to jump to each."
   - "A checklist for this migration's steps that remembers what I ticked."
   - "Rollbar errors for this project over the last week, by day."
   - "A form that fills in the fields of a Linear issue and puts the text in the composer."
3. For each prompt, the agent writes a dev-mode plugin with one tree pane, following the note. Count
   the tries until the owner calls the result useful, up to three.
4. Record for each attempt: tries, errors, kit components or properties it wanted and could not find,
   and whether a dashboard panel would have done the job.

## The three plumbing questions

Answer each with a small proof, not a design:

1. **A card inside a card.** Contribute an `agents:tool-card` tree that mounts a second plugin's tree
   through a slot. Does it render, take focus, and resize?
2. **Headless validation.** Boot a tree once on the Node in a worker, against empty data, and collect
   its thrown errors and unknown components. Is the runtime reachable from the Node, or only from the
   client packages?
3. **Worker cost.** Open a transcript with ten live trees. Record memory and start time per worker, on
   desktop and in the terminal client.

## Exit criteria

- **Go** if at least seven of ten prompts reach a useful result within two tries, and the plumbing
  questions have answers that do not need a new host primitive.
- **Go with changes** if the misses cluster on a few missing kit components. List them. Adding them is
  the first slice of phase 1.
- **Stop or rethink** if fewer than five of ten succeed, or most successes are single-source tables and
  charts. In the second case, an agent tool that creates dashboard panels comes first. See
  [refused](./refused.md#dashboard-panels-as-the-only-answer).

## Results

Not run.

## Verify before building

- The scaffold's current output, so the authoring note matches it.
- That dev mode works in a `pnpm dev:agent` window, as [local development](../../local-development.md)
  describes.
