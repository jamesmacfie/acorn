# Memory in the next architecture

**Status:** design contract - addendum to [notes-and-memory.md](../notes-and-memory.md) for the
plugin-platform work.
**Companions:** [contribution-points.md](./contribution-points.md) §4.7/§4.8,
[state-and-policies.md](./state-and-policies.md) §5, [integrations.md](./integrations.md),
[agent-runtime.md](./agent-runtime.md).

The current memory design is intentionally conservative: repo memory is committed markdown,
private memory is local markdown, SQLite is a derived FTS index, and agent writes are proposals
that a human gates. The next architecture keeps those invariants. Plugins, integrations, and
workflow triggers can create more evidence and more proposal sources, but they do not get to turn
memory into an opaque plugin database or an agent-owned scratchpad.

## 1. Non-negotiable invariants

1. **Files remain the durable truth.** Repo memory lives in `.acorn/memory/*.md` and is reviewed
   through git. Private memory lives under `~/.acorn/memory/*.md`. The `memories` table remains a
   derived retrieval index and may be rebuilt.
2. **Agents and workflows propose; humans accept.** Any non-human durable memory write enters the
   proposal queue first. This includes interactive agents, headless workflow steps, plugin
   automations, integration triggers, and consolidation passes.
3. **Memory bodies are not ambient context.** Context assembly and launch injection include an
   index slice by default. Agents pull bodies with `memory_get` when needed. This preserves token
   budget and keeps stale or irrelevant durable knowledge from crowding out task facts.
4. **Memory is cross-agent, not per-agent.** Agent profiles change capture and provenance, not
   visibility. A Codex-discovered repo convention should help a later Claude or Aider session
   unless scoped otherwise by repo/private/team policy.
5. **Plugin-owned facts do not bypass core governance.** A plugin may contribute evidence,
   proposal extractors, context formatters, or tools. Core owns memory storage, proposal review,
   indexing, supersession, retention, and deletion semantics.
6. **Secrets and volatile provider payloads are not memories.** Integration tokens, raw webhook
   bodies, transient API errors, and mirrored provider JSON stay in provider storage. Memory stores
   durable lessons, decisions, conventions, and verified references.

The useful lesson from `references/agentmemory` is not "copy the whole memory server." Its strongest
ideas for Acorn are: explicit provenance, scopes, supersession instead of silent overwrite,
source-observation links, retention/audit hooks, and multiple capture adapters. Acorn should adopt
those where they fit the local-file, human-gated model; it should not adopt silent auto-remembering
as the durable write path.

## 2. Scope model

Current Acorn scopes are enough if they are named precisely:

| Scope | Durable home | Who sees it | Examples |
| --- | --- | --- | --- |
| `repo` | `<worktree>/.acorn/memory/*.md` | everyone working on the repo after review/merge | architecture decisions, conventions, known fixes |
| `private` | `~/.acorn/memory/*.md` | this machine/operator | personal preferences, local setup, private account quirks |
| `proposal` | app data under `apps/desktop/.acorn/memory-proposals/` | reviewer until accepted/rejected | agent/workflow/integration suggestions |
| `run` | workflow handoff notes, not memory | only the workflow run | intermediate step outputs |
| `task` | notes/review notes, not memory | current task or workspace according to notes rules | active plan, findings, handoff text |

Do not add a plugin-specific durable memory scope. Plugin-specific data belongs in plugin T1/T2
storage; durable cross-session knowledge either belongs to the repo, to the operator privately, or
does not belong in memory. If a future team/shared-private scope appears, it is a core memory
scope with review and deletion semantics, not a provider-specific side channel.

## 3. Memory records and provenance

The markdown file stays readable, but the frontmatter/index should be rich enough for plugins and
workflows to reason without parsing prose. The next memory shape should preserve today's fields and
make these explicit:

```ts
type MemoryScope = 'repo' | 'private'
type MemoryOriginKind = 'user' | 'agent' | 'workflow' | 'integration' | 'consolidation'

interface MemoryOrigin {
  kind: MemoryOriginKind
  sessionId?: string
  workflowRunId?: string
  workflowStepId?: string
  pluginId?: string
  providerId?: string
  connectionId?: string
  sourceRefs?: Array<
    | { type: 'file'; path: string; commitSha?: string }
    | { type: 'task'; taskId: string }
    | { type: 'integration-ref'; providerId: string; refJson: unknown }
    | { type: 'note'; slug: string }
  >
}
```

Rules:

- `originSessionId` remains the fast path for current UI, but `origin` is the durable contract.
- `sourceRefs` point to evidence. They do not make the evidence part of the memory body.
- Provider refs use the provider codec from [integrations.md](./integrations.md) §5/§7. Core never
  stores provider-specific display strings as identity.
- Supersession remains append-only: a contradiction creates a new memory with `supersededBy`/
  `supersedes` linkage. It does not edit the old file in place silently.

## 4. Contribution points

Memory is not a plugin contribution point in the sense of "register your own store." The extension
points are narrower:

```ts
interface MemoryCandidateContribution {
  id: string
  ownerPluginId: string
  sources: Array<'task-diff' | 'session-transcript' | 'workflow-step' | 'integration-event'>
  propose(input: MemoryCandidateInput, ctx: MemoryProposalContext):
    Promise<MemoryCandidate[]>
}

interface MemoryEvidenceFormatter {
  providerId: string
  summarizeEvidence(ref: ExternalRef, budget: Budget): Promise<string | null>
}
```

Core owns when candidate contributors run, the proposal queue, structural verification, warnings,
and accept/reject. Contributors only suggest candidates.

This gives plugins three legitimate memory hooks:

- **Evidence formatting** - an integration can summarize linked evidence for a proposal, using the
  same staleness and budget posture as task context.
- **Candidate extraction** - a workflow or provider can suggest a durable lesson after a run,
  incident, comment thread, or repeated fix pattern.
- **Agent tools** - `memory_search`, `memory_list`, `memory_get`, and `memory_write` remain core
  tools projected through [contribution-points.md](./contribution-points.md) §4.8. Provider-owned
  tools may create evidence or task links, but not accepted memory files.

There is deliberately no `ctx.memory.writeAccepted(...)` for plugins or agents. The only direct
accepted write path is a human UI action.

## 5. Integrations

Integrations change memory by increasing evidence, not by owning memory.

Provider data can produce memory candidates when:

- a linked external item explains a repo convention or failure mode that will recur;
- a provider mutation records a decision that should outlive the ticket/comment;
- a workflow trigger repeatedly fixes the same provider-reported issue;
- a human explicitly promotes linked context into memory.

Provider data should not become memory when:

- it is merely the current status of an issue, incident, check, or alert;
- it contains secrets, user tokens, personal data, or raw logs;
- it is provider-specific data better served by the mirrored-resource cache;
- the provider connection is unhealthy and the evidence cannot be verified.

Memory candidates sourced from integrations must carry `providerId`, `connectionId`, and a codec-owned
external ref in provenance. If a connection is disabled, existing accepted memories remain but render
their evidence link as inert. If a connection is disconnected and cascaded, accepted memories are not
deleted automatically; their source refs degrade the same way old commit links can degrade. Deleting
or redacting accepted memory is a separate human/governance action.

## 6. Workflows and agents

Workflow outputs split into three layers:

| Layer | Store | Purpose |
| --- | --- | --- |
| Step/run state | `workflow_steps` / `workflow_runs` | durable audit and resume |
| Handoff | per-run task note | pass data to later steps in the same run |
| Memory proposal | proposal queue | durable lesson for future tasks |

Do not use memory as the data bus between workflow steps. The handoff-note fix in
[agent-runtime.md](./agent-runtime.md) §2.1 creates the missing run scope. Memory is for what should
survive the task, not for what step B needs from step A.

Workflow memory generation should run at explicit boundaries:

- after an interactive agent session ends, as it does today;
- after a workflow run reaches a terminal state;
- after a human resolves a gate with feedback that changes the lesson;
- optionally during a future consolidation sweep.

The generator receives the diff, transcript tail, structured step outputs, handoff notes for that
run, existing memory index, and relevant linked-provider context. It emits candidates only. Core
then verifies file refs, duplicate content hashes, same-name contradictions, source-ref shape, and
budget limits before queueing proposals.

## 7. Retrieval and context

Retrieval has three paths:

1. **Launch injection:** compact repo memory index slice, not full bodies.
2. **Task context:** memory context section with `overflow: 'index-only'`.
3. **Agent pull:** `memory_search`/`memory_get` for targeted recall.

The search implementation can evolve from FTS5 to hybrid retrieval later, but the contract does not
depend on embeddings. If hybrid search lands, it is a derived index like FTS and must be rebuildable
from memory files plus accepted metadata. It cannot become the source of truth.

Plugins must not inject their own durable-memory blocks around the core context section. If a plugin
has linked context, it contributes a context section or provider formatter; if it has durable lessons,
it contributes proposals.

## 8. Retention, deletion, and audit

Memory has a stronger preservation posture than mirrored provider data:

- accepted repo/private memories are never deleted by provider disconnect, plugin disable, task
  archive, or ordinary mirror retention;
- superseded memories may be compacted only by an explicit memory-retention policy with audit output;
- proposals can be pruned after a named age only if they were rejected or are structurally invalid;
- accepted-memory deletion/redaction is a governance action, not a cache sweep.

The next retention pass in [state-and-policies.md](./state-and-policies.md) §5.2 should therefore
separate:

- **proposal cleanup** - safe to age out rejected/stale proposals;
- **index rebuild/compaction** - safe because the index is derived;
- **accepted-memory compaction** - high-trust, audited, and never tied to provider/plugin lifecycle.

## 9. Implementation obligations

The implementation plan needs three additions:

1. **Phase 4:** the agent-tool projection must preserve the memory asymmetry:
   `memory_write` maps to proposal creation only, and write-tier permissions do not create an
   accepted-write bypass.
2. **Phase 7:** provider descriptors must include memory evidence/proposal rules so integration
   context, mutations, and triggers can feed memory without storing provider payloads as memories.
3. **Phase 8 / ongoing:** workflow terminal-state hooks should run the same proposal generator as
   interactive agent-session-end, with run-scoped handoff notes as input and accepted memory as
   output only after human review.

## 10. Completeness checklist

A memory-era PR is incomplete unless it answers:

- What is the source of truth: memory file, proposal file, derived index, provider mirror, note, or
  workflow row?
- Who can write it directly: human, agent proposal, workflow proposal, plugin service, or sync
  engine?
- What scope does it have: repo, private, task, run, workspace, app, provider connection?
- How is provenance retained after plugin disable, provider disconnect, task archive, or worktree
  cleanup?
- Does this belong in memory, or is it better as context, a note, a mirrored row, or workflow state?
- If an agent can initiate it, where is the human gate?
