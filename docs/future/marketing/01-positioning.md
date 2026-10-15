# Phase 1: decide what acorn is, in one line

Date: October 15, 2026. Status: done. Phases 5 and 8 build on it.

## Goal

A visitor reads the top of the landing page for five seconds and can say what acorn does. Everything
else on the site hangs off that line, so it gets decided first, before anyone designs a hero.

acorn does a lot: tasks and worktrees, managed agents, GitHub review, Git, an editor, database and
HTTP panes, Docker, workflows, dashboards, notes and memory, a terminal client, a command line, a
browser extension, remote Nodes, and a plugin system. A landing page that lists all of that says
nothing. This phase picks the one idea the rest supports, and the order the rest comes in.

## Decisions

James made these on October 15, 2026.

### The headline

> A workspace for working with coding agents, one task at a time.

The paragraph under it is the one in [voice](./voice.md#the-one-line-description), unchanged:

> Open a task and acorn gives it a branch, a Git worktree, terminals, and agent sessions, with the diff
> and the pull request in the panes beside them. Use it from the desktop app or from your terminal.
> It's the same workspace either way.

The eyebrow isn't chosen. [Phase 8](./08-landing.md) writes it: uppercase mono, under five words, saying
who acorn is for or what it runs, to [voice](./voice.md). Record the result here.

### No five-second test

James dropped the test with outside developers. The headline above is final. Phase 8 doesn't repeat a
test on the built page either.

### The feature ranking

The feature groups, in the order a newcomer needs them. The landing page's tour and the features index
use this order.

1. Tasks: what a unit of work is in acorn, and why it owns a worktree.
2. Agents: Claude Code and Codex running inside a task.
3. Review: the diff and the pull request beside the agent.
4. Desktop and terminal: the same workspace in both.
5. Task tools: editor, database, HTTP, Docker, preview, Linear, and Rollbar.
6. Plugins: adding what's missing.
7. Nodes: running it on another machine.
8. Browser extension, automation, and security.

Each group maps to a page in [the site map](./site-map.md#marketing-pages).

### The three levels

- **Five seconds**: the eyebrow, the headline, and the paragraph. What acorn is and who it's for.
- **Thirty seconds**: the hero picture and the three-step "how it works" strip. Open a task, run agents
  in it, review and ship from the same window.
- **Three minutes**: the rest of the landing page, in the order [phase 8](./08-landing.md) lists.

### The landing outline

The 11 sections in [phase 8](./08-landing.md#the-page-from-top-to-bottom) stand as written, in that
order.

### The owner's decisions

All seven are answered in [the README](./README.md#what-the-owner-decides).

## Out of scope

Visual design, page layout, and writing the full landing copy. This phase decided the words at the top
and the order of everything after them.
