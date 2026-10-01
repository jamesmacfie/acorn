# Phase 1: agents write memory directly

Status: proposed, 2026-10-01. Read [design.md](./design.md) first. This phase builds the write path,
standing context, and the transcript card from that design.

## Goal

An agent saves a memory in the turn it learns something, and every new session, in every harness,
starts with the memory index in its system prompt. The owner sees each write in the transcript and can
undo it.

Findings stays installed and untouched. Memory stops calling it. That keeps this phase reversible:
if direct writes turn out badly, one revert restores the proposal path.

## What the owner gets at the end

- Agents save memories without asking, and say so only when it matters.
- A new managed Claude or Codex chat already knows the project's memory index, with nothing ticked in
  the Context pane.
- A terminal Claude Code session gets the same index at launch instead of an instruction to go and
  fetch it.
- Each save or delete shows as a card in the transcript with **Open** and **Undo**.
- Every overwritten or deleted memory can be restored from history.

## Starting point

- Files, frontmatter, the generated `MEMORY.md`, and atomic writes exist in
  `plugins/memory/src/server/memory.ts`.
- `memory_write` forwards to Findings through the `FINDINGS_AGENT_PROPOSAL` capability in
  `plugins/memory/src/server/agentTools.ts`.
- The launch block is built in `plugins/memory/src/server/knowledgeChannel.ts` and delivered by
  Terminal through `terminal:launch-context`.
- The memory context section is registered from `plugins/memory/src/server/contextSection.ts`, with
  `defaultIncluded: false`.
- Custom agent instructions already reach each harness's system prompt, stored on the session config
  so a resume sends the same text: `plugins/agents/src/server/drivers/claudeHarness.ts`,
  `plugins/agents/src/server/drivers/codexDriver.ts`, and `plugins/agents/src/server/drivers/acpDriver.ts`.

## Requirements

### Writing

1. `memory_write` writes the file directly and never calls Findings.
2. Writing a name that exists in the scope requires the current `hash`. A missing or stale hash fails,
   and the error carries the current hash.
3. `memory_delete` takes `scope`, `name`, and `hash`, and moves the file to history.
4. `memory_get` returns the memory's `hash`. `memory_list` returns every entry's name, description,
   type, and `updatedAt`.
5. Every write validates the name rule, a one-line description of at most 200 characters, and a body of
   at most 16 KiB.
6. Every write runs the [write-time checks](./design.md#write-time-checks) and refuses with the reason.
7. Before a write replaces a file or a delete removes one, the current file moves into `.history/`. The
   last 20 versions per name are kept.
8. Every write, delete, and restore appends one line to `changes.jsonl` with the scope, name, action,
   author, session, and task. The file keeps its most recent 1,000 lines.
9. A write stamps `metadata.updatedAt` and `metadata.updatedBy` in the frontmatter.
10. The four-value `type` applies to new writes. Old values map on read and are not rewritten.

### Standing context

11. The memory contract is one Markdown file in the memory plugin, used by every delivery path.
12. The memory plugin publishes a node capability that returns standing context for a task: the
    contract, the capped private index, and the capped project index.
13. The caps default to 4,000 characters for private and 12,000 for project, read from memory
    preferences. A capped index ends with the truncation marker from [the design](./design.md#what-goes-in).
14. The agents plugin builds standing context once when it creates a session and stores the text on the
    session config. A resume sends the stored text unchanged.
15. Each harness receives standing context through the seam in
    [the delivery table](./design.md#where-it-goes-per-harness).
16. With the memory plugin disabled, sessions start with no standing context and no error.
17. The Claude Code terminal profile's `--append-system-prompt` carries standing context instead of the
    instruction to call `task_context` first. The rest of that instruction, about notes and linked
    issues, stays.
18. The memory context section is no longer registered, so it leaves the Context pane and
    `task_context`.

### Seeing and undoing

19. The memory plugin contributes an `agents:tool-card` renderer for `memory_write` and
    `memory_delete`. It shows the scope, the name, and the description, with **Open** and **Undo**.
20. **Undo** restores the previous version from history, or deletes a memory the write created. It
    requires a device principal, never a task credential.
21. **Open** goes to the memory on the Memory page.

### Safety

22. A development session started with `pnpm dev:agent` cannot write into the owner's real memory
    root. If the shipped root ignores `ACORN_DATA_DIR`, this phase fixes that first.

## Out of scope

- Removing Findings, the review page, the search index, or the producers. That is [phase 2](./02-remove-findings.md).
- Settings UI for the caps, the change feed, version history on the Memory page, and import. That is
  [phase 3](./03-memory-page-and-import.md).
- Turning off Claude Code's own memory. Phase 1 records whether the setting exists.

## Steps and checkpoints

### 1. Isolate development sessions

Check where `privateMemoryRoot` points during `pnpm dev:agent`. Fix it if it points at the owner's
home folder.

**Checkpoint 1.** Start a `dev:agent` session, write a memory through the Memory page's add form, and
confirm the file lands under the session's data folder, not `~/.acorn/memory`.

### 2. The write path

Change `memory_write`, add `memory_delete`, and add the hash, limits, checks, history, and change log.
Unit tests cover each requirement from 1 to 10, including the hash conflict and history rotation at 21
versions.

**Checkpoint 2.** In a managed Claude chat, ask the agent to remember a fact. The file appears in the
project folder, `MEMORY.md` lists it, and `changes.jsonl` has one line. Ask it to save a memory that
contains "ignore previous instructions". The tool refuses with the reason.

### 3. The transcript card

**Checkpoint 3.** The save from checkpoint 2 shows as a card. **Undo** removes the file and the index
line. A second save of the same name, then **Undo**, restores the first version.

### 4. Standing context

Add the contract file, the capability, the builder, and the session snapshot. Wire the three managed
seams and the two terminal paths. Driver tests assert that a resume sends byte-identical standing
context.

**Checkpoint 4.** With five project memories on disk, start a fresh managed Claude chat and ask, with no
other context, which memories it can see. It lists all five without calling a tool. Repeat with Codex.
Repeat in a terminal Claude Code session.

**Checkpoint 5.** Write 200 short memories with a script, start a chat, and ask for the last line of its
project index. It quotes the truncation marker.

**Checkpoint 6.** Resume a chat created before a new memory was written. It does not list the new
memory until it calls `memory_list`, and its earlier turns stay intact.

### 5. Remove the duplicate delivery path

Stop registering the memory context section and update the `task_context` description.

**Checkpoint 7.** The Context pane has no memory section, and `task_context` output has no memory index.

## Measure before phase 2

Use the build for two weeks of ordinary work, then record in this file:

- How many memories agents wrote, per project.
- How many the owner undid or deleted, and why.
- Two or three examples of good saves and bad saves.
- Whether the owner still wants a queue.

Phase 2 deletes the proposal path for good. Go ahead only if the owner judges the noise acceptable.

## Docs that change

- [Notes and memory](../../notes-and-memory.md) § Memory and § Context integration: direct writes,
  standing context, the card, history.
- [Agent tools](../../agent-tools.md): `memory_write` semantics, `memory_delete`, and the `hash` rule.
- [Managed agents](../../managed-agents.md): standing context on session creation and resume.
- [Terminal](../../terminal.md): the Claude Code launch prompt.

## Verify before building

- Where the agents plugin creates a session and stores `customAgent` on its config, so standing
  context is stored the same way.
- Whether a node capability or a `terminal:launch-context`-style extension point is the right seam for
  the agents plugin to read standing context. The capability is simpler if memory stays optional.
- Whether Claude Code's ACP adapter accepts a system prompt append of about 16 KiB without trimming.
- Whether Claude Code exposes a setting to turn off its automatic memory, and its current name.
