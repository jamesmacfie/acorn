# Phase 1: decide what acorn is, in one line

Date: October 15, 2026. Status: proposed. Blocks phases 5 and 8.

## Goal

A visitor reads the top of the landing page for five seconds and can say what acorn does. Everything
else on the site hangs off that line, so it gets decided first, with evidence, before anyone designs a
hero.

acorn does a lot: tasks and worktrees, managed agents, GitHub review, Git, an editor, database and
HTTP panes, Docker, workflows, dashboards, notes and memory, a terminal client, a command line, a
browser extension, remote Nodes, and a plugin system. A landing page that lists all of that says
nothing. This phase picks the one idea the rest supports, and the order the rest comes in.

## Starting point

- [Voice](./voice.md#the-one-line-description) holds three candidate lines and the paragraph under
  them.
- [Research](./research.md) has how herdr, opencode, paseo, and orca open their pages. The common shape
  is a mono eyebrow, a headline under ten words, two sentences of plain explanation, and an install
  action.
- `README.md` opens with "acorn is an agent workspace." `docs/features.md` describes acorn as "a
  task-oriented coding workspace with GitHub review built in."
- [The owner's decisions](./README.md#what-the-owner-decides) are open.

## Steps

### 1. Rank the features by what a newcomer needs first

Take every section of `docs/features.md` and sort it into the feature groups in
[the site map](./site-map.md#marketing-pages). Then rank the groups by the question a newcomer asks
first. The recommended order:

1. Tasks: what a unit of work is in acorn, and why it owns a worktree.
2. Agents: Claude Code and Codex running inside a task.
3. Review: the diff and the pull request beside the agent.
4. Desktop and terminal: the same workspace in both.
5. Task tools: editor, database, HTTP, Docker, preview, Linear, and Rollbar.
6. Plugins: adding what's missing.
7. Nodes: running it on another machine.
8. Browser extension, automation, and security.

Write the ranking into this file under a heading "Decisions", with a sentence of reason for anything
that moves.

### 2. Write the three levels

Write what a reader takes away at each depth, in plain sentences:

- **Five seconds**: the eyebrow, the headline, and the paragraph under it. What it is and who it's for.
- **Thirty seconds**: the hero picture and the three-step "how it works" strip. Open a task, run agents
  in it, review and ship from the same window.
- **Three minutes**: the rest of the landing page, in the order [phase 8](./08-landing.md) lists.

### 3. Test the line with people

Run a five-second test with at least five developers who use a coding agent and haven't seen acorn.
Show each one a static mockup of the hero for five seconds, hide it, and ask:

1. What does this product do?
2. Who is it for?
3. What would you click first?

Test each candidate line from [voice](./voice.md#the-one-line-description), plus any new ones, with a
different set of people per line if you can. Record every answer verbatim in this file. Pick the line
the most people restate correctly in their own words. Don't pick the line people like best. Pick the
one they understand.

### 4. Get the owner's decisions

Walk James through [the seven decisions](./README.md#what-the-owner-decides). Record each answer and
its date in the README list, replacing the recommendation. The license answer changes the landing
page and the FAQ, so it can't wait for phase 8.

### 5. Confirm the landing outline

Read the section list in [phase 8](./08-landing.md#the-page-from-top-to-bottom) with James. Cut or
reorder sections to match the ranking from step 1. Record the result in phase 8.

## Out of scope

Visual design, page layout, and writing the full landing copy. This phase decides the words at the top
and the order of everything after them.

## Acceptance

- One headline, one eyebrow, and one paragraph are chosen, with the five-second test answers recorded.
- At least four of five testers name both "coding agents" and "tasks" or "worktrees" when asked what
  acorn does. If no candidate gets there, write new candidates and test again.
- The seven owner decisions are recorded with dates.
- The feature ranking and the landing outline are recorded and approved.

## Risks

The likely failure is a line that's accurate and forgettable, because "workspace" is a word every tool
uses. The five-second test catches that. A line testers restate correctly beats a clever one.
