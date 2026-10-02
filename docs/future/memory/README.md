# Simple memory

Status: phases 1 and 2 implemented for verification; phase 3 implemented, 2026-10-02. Phase 2 proceeded by explicit
owner request before phase 1's two-week measurement finished. Phase 4 waits on cloud teams. Where a file here disagrees with a shipped contract, the owning reference document wins until the implementation
changes that contract.

## What this is

Agents write memory directly, in the turn where they learn something, and every new session starts
with the memory index already in its system prompt. Phase 2 removes the review queue, the Findings plugin, and the
search index behind them. Memory becomes Markdown files, one index file per scope, a handful
of agent tools, and a page where the owner can read, edit, delete, and undo.

This is the shape Claude Code, Lemma, and bb all use. Acorn's shipped memory stores its files the same
way. Before phase 1, agents could only propose, a person had to approve each proposal, and recall
depended on the agent choosing to look. For the evidence that this is why
memory barely gets used, read [the problem](./design.md#the-problem).

## Read this programme

| File | What it covers |
| --- | --- |
| [design.md](./design.md) | The problem, the model, the memory contract prompt, delivery per harness, the write path, safety, history, and the Memory page. |
| [research.md](./research.md) | How Claude Code, Lemma, bb, and agentmemory do memory, and what each one teaches. |
| [refused.md](./refused.md) | What this programme decided not to build, and when to revisit it. |
| [01-direct-writes.md](./01-direct-writes.md) | Phase 1. Agents write memory directly, and the index goes into every new session's system prompt. |
| [02-remove-findings.md](./02-remove-findings.md) | Phase 2. Delete the Findings plugin, its producers, the review page, and the search index. |
| [03-memory-page-and-import.md](./03-memory-page-and-import.md) | Phase 3. The Memory page as a plain library with a change feed and undo, plus import from Claude Code and repo folders. |
| [04-teams.md](./04-teams.md) | Phase 4. Shared project memory and per-person private memory on a team Node. Waits on the cloud programme. |

## The phases at a glance

| Phase | What the owner gets at the end | Depends on |
| --- | --- | --- |
| 1 | Agents save memories without asking, every new session sees the index, and every write shows as a card in the transcript with **Undo**. | Nothing. |
| 2 | One memory system instead of two plugins. No review settings, no archive review, no review notices. | 1. |
| 3 | A Memory page that lists, searches, edits, and restores memories, a feed of recent agent writes, and a one-time import of Claude Code's memory folder. | 2. |
| 4 | Project memory shared by a team, private memory per person, and every write attributed. | 3, and [cloud phase 9](../cloud/phases/09-teams.md). |

Phase 1 is reversible: Findings stays installed while agents stop using it. Phase 2 is the one-way
door, so it comes second, after phase 1 has shown that direct writes work.

## Terms

| Term | Meaning |
| --- | --- |
| _Memory_ | One Markdown file with frontmatter: a name, a one-line description, a type, and a body. |
| _Scope_ | Where a memory applies. _Project_ memory applies to one project. _Private_ memory applies to the owner everywhere. |
| _Index_ | The `MEMORY.md` file in each scope's folder: one line per memory, name and description. Generated from the files. |
| _Memory contract_ | The fixed instructions that tell an agent how and when to read and write memory. |
| _Standing context_ | The memory contract plus the capped indexes, placed in a session's system prompt when the session is created. |
| _History_ | Earlier versions of a memory, kept beside it so a write or a delete can be undone. |

## Docs that change

Each phase updates the owning documents it touches. Taken together, the programme rewrites
[notes and memory](../../notes-and-memory.md) § Memory and § Context integration, deletes
findings (retired; see Git history for docs/findings.md), and edits these:

- [Agent tools](../../agent-tools.md), for the memory tools and the removal of the four `findings_*` tools.
- [API reference](../../api-reference.md), for the memory routes and the removed Findings routes.
- [Loaded-plugin migration](../../loaded-plugin-migration.md), [plugin map](../../plugin-map.md), and
  [first-party plugins](../../first-party-plugins.md), which list Findings.
- [Managed agents](../../managed-agents.md), for standing context on session creation and resume.
- [Workflows](../../workflows.md), [schedules](../../schedules.md), [terminal](../../terminal.md), and
  [notifications](../../notifications.md), which describe the Findings producers and the review notice.
- [Node-side extension points](../../plugins/node-side-extension-points.md) and
  [the node half](../../plugin-authoring/the-node-half.md), which use Findings as the worked example of
  a producer extension point.
- [Command palette and shortcuts](../../command-palette-and-shortcuts.md), [panes](../../panes.md),
  [frontend](../../frontend.md), [features](../../features.md), and [testing](../../testing.md).

`notes` keeps its `finding` note kind. That kind is a note an agent appends, and it has nothing to do
with the Findings plugin despite the shared word.

## Verify before building

Recheck the shipped memory contract in [notes and memory](../../notes-and-memory.md#memory), the
Findings contract in findings (retired; see Git history for docs/findings.md), and the harness system prompt seams in
[managed agents](../../managed-agents.md) before each phase. Do not describe a proposal in this folder
as shipped.
