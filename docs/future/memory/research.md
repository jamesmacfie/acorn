# How other tools do memory

Status: research notes, 2026-10-01. Read from the clones under the main checkout's `references/`
folder, which is not part of the repository, and from Claude Code as used on the owner's machine.
Treat version-specific details as dated.

## The short answer

Three of the four tools studied converge on one shape, and it is the shape [design.md](./design.md)
adopts: memory is small Markdown records, an index of one-line summaries goes into the prompt every
session, and the agent writes directly. The fourth, agentmemory, is the opposite extreme and is the
clearest picture of where Acorn's shipped design was heading.

| | Claude Code | Lemma | bb | agentmemory | Acorn, shipped |
| --- | --- | --- | --- | --- | --- |
| Store | Markdown files | Markdown files in the pod's file store | SQLite rows | Key-value store plus search indexes | Markdown files plus a SQLite index |
| Who writes | The agent, directly | The agent, directly | The agent, directly | Hooks, on every tool call | A person, approving an agent's proposal |
| What loads every session | `MEMORY.md`, truncated past a line limit | Four `AGENTS.md` indexes, capped per scope and in total | A summary catalog, capped at 3,900 characters | A search result set, about 2,000 tokens | Nothing by default in a managed chat |
| Scopes | One folder per project | Pod, pod per agent, person, person per agent | Global and project | Per agent, shared or isolated | Private and project |
| Review | None. The owner edits files. | None. The ordinary file browser. | A settings table to edit and delete | A web viewer | A review queue before anything lands |
| Conflict rule | None | None, stated as a known gap | Expected version on update | Contradiction detection | Revision and payload hashes on approval |

## Claude Code

Claude Code keeps one folder per project, with one file per memory and a `MEMORY.md` index of one line
per file. The index loads at session start. The instructions tell the agent what to save, what not to
save, to check for an existing memory before writing, and to keep the index as pointers rather than
content.

What it teaches: this is enough. The owner's folder for this repository holds 183 memories written
over about two months, and they are used every session. The index is the whole recall mechanism, and
it works because it is always there. Nothing has to decide to look.

## Lemma

Lemma is a shared agent workspace for teams, with a Python backend and a per-pod file store. Its
memory design is in `lemma-platform/docs/architecture/agent-memory.md` and the prompt is
`lemma-backend/app/modules/agent/prompts/memory.md`.

- **Memory is files, on purpose.** Files already had per-person isolation, path-based permissions,
  versioning, and search, so a memory table would have reinvented each one. The same reasoning applies
  to Acorn's files.
- **Four indexes, always loaded.** `/memory/AGENTS.md` for the pod, `/memory/agents/<slug>/AGENTS.md`
  per agent, `/me/AGENTS.md` per person, and `/me/agents/<slug>/AGENTS.md` per person per agent. Each
  is capped at 2,000 characters, and the section at 6,000, spent narrowest scope first.
- **Truncation says so.** A cut index ends with a marker naming the file and the dropped line count,
  because the agent is the only party that can fix a bloated index and a silent cut hides the problem.
- **The contract is one file.** It used to be three hand-synced copies, which the code comment calls
  "two more than can stay true."
- **Memory is a capability with no tools.** Reading and writing go through the ordinary file tools.
  Granting memory without file access is refused, because it would promise something the agent cannot
  do.
- **The index is agent-maintained**, which forces a cache with write-time invalidation from two
  directions. Acorn generates its index from the files instead, which removes that problem.
- **Stated gaps:** no consolidation, no deduplication, contradicting writes go unnoticed, and no memory
  UI beyond the file browser.

## bb

bb is a local agent workspace with a plugin system. Its memory plugin is `plugins/memory/` in the bb
clone: `server.ts`, `skills/memory/SKILL.md`, and `PLUGIN_OVERVIEW.md`.

- **Direct writes with a reason.** `bb memory add` takes a scope, name, summary, details, kind, tags,
  importance, and a required `--reason`. Update and forget take an expected version.
- **A catalog in the instructions on every turn**, through `bb.agents.contributeInstructions`. It holds
  summaries only, capped at 3,900 characters, with a footer that says how many entries were left out
  and how to list them.
- **Write-time safety checks.** `unsafeMemoryReason` refuses invisible and bidirectional characters,
  role-like tags, "ignore previous instructions" phrasing, private keys, token-shaped secrets, and
  credential assignments. [design.md](./design.md#write-time-checks) adopts the list.
- **Progressive retrieval.** Search returns summaries, `get` returns one record, and the skill says to
  stop once the relevant records are clear.
- **Provider-native memory conflicts.** The setup notes tell the owner to turn off a provider's own
  memory to avoid duplicates. Acorn has the same problem with Claude Code.
- **A settings table** where the owner reviews, edits, and deletes every memory, with version history.

bb is the closest match to where Acorn should end up. The main difference is storage: bb uses SQLite
rows, and Acorn already has files the owner can open in an editor.

## agentmemory

agentmemory is a standalone memory server for many agents. Its README describes the pipeline.

- Hooks record every prompt, tool call, tool result, and error.
- A four-tier model moves raw observations to session summaries, then to facts, then to procedures.
- Memories decay on a forgetting curve, strengthen when recalled, and are evicted when stale.
  Contradictions are detected and resolved.
- Search combines keyword, vector, and knowledge graph results.
- It exposes 54 tools.

It compares itself to built-in memory directly, calling `MEMORY.md` a sticky note and itself the
searchable database behind it. The comparison is fair on scale and token cost. It is also a picture of
what Acorn's Findings pipeline was growing into: automatic capture, candidate preparation, supersession,
recall counters kept for future decay. Acorn's owner has 183 working sticky notes and 19 database
entries. For one person or a small team, capture-everything-and-rank costs more than it returns.

## What Acorn takes

- From Claude Code: the index in the prompt at session start, and the confidence that this alone is
  most of the value.
- From Lemma: per-scope caps with a visible truncation marker, one contract file for every harness, and
  the reasoning for files over a table.
- From bb: direct writes with an optimistic version check, write-time safety checks, a summary catalog
  footer that says what was left out, and a library page with edit, delete, and history.
- From agentmemory: nothing to build. It marks the direction to avoid.
