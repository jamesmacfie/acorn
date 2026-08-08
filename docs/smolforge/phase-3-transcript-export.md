# Phase 3 — Transcript export capability

**Size: S.** Provider-neutral (any consumer that wants session transcripts: forges, knowledge
tools, audit exporters). After this phase a plugin can read a completed agent session as a
portable transcript with enough metadata to link it to a repo and commit.

## Context

The agents plugin owns managed agent sessions and persists **normalized events in a durable
per-session sequence** (docs/architecture-overview.md § Agent execution; storage under
`plugins/agents/src/node/schema.ts`). Nothing outside the plugin can read them: there is no
capability, and other plugins must not touch its SQLite (boundary rules). SmolForge's transcript
feature (`forge/llms.txt` § AI Transcripts: `POST /api/repos/:owner/:repo/transcripts`, body
with `content` JSONL + optional `commit_sha`; list/get by session or commit) wants exactly this
data, uploaded when a session completes.

Design question settled here: **export normalized events, not raw provider JSONL.** The agents
plugin stores normalized events across Claude/Codex/Aider profiles; raw provider logs may not be
retained at all. SmolForge accepts "agent formats that can be parsed server-side" and generic
JSONL — a documented, stable acorn JSONL shape is a better upload artifact than pretending to be
Claude Code's format, and it is provider-count-proof. If the acorn shape isn't parsed by a
consumer, the JSONL is still self-describing.

## The capability

In the agents contract (beside `plugins/agents/src/contract/sessionExecute.ts`, same
`capabilityId<T>` pattern):

```ts
export type AgentTranscriptMeta = {
  sessionId: string
  taskId: string
  projectId: string
  agentKind: string            // 'claude' | 'codex' | 'aider' | profile id
  startedAt: number
  endedAt: number | null
  eventCount: number
  headShaAtEnd: string | null  // observed worktree HEAD when the session ended, if known
}

export type AgentTranscriptExport = {
  listCompleted(opts: { taskId?: string; afterSessionId?: string; limit?: number }): Promise<AgentTranscriptMeta[]>
  read(sessionId: string): Promise<{ meta: AgentTranscriptMeta; jsonl: string } | null>
}

export const AGENTS_TRANSCRIPT_EXPORT = capabilityId<AgentTranscriptExport>('agents.transcriptExport')
```

Notes:

- `jsonl` is one event per line in a documented shape: `{ seq, at, type, role?, text?, tool?,
  … }` — a rendering of the existing normalized event rows, versioned with a header line
  (`{"acornTranscript": 1, "sessionId": …}`). Write the shape down in the agents plugin docs;
  it is a contract the moment one consumer exists.
- **Secret masking is the consumer's problem only partially.** SmolForge masks server-side
  before *display*, but the upload still transmits whatever the transcript contains. Apply the
  same redaction the agents plugin already applies to its own surfaces (if any) at export time,
  and document that exports are not additionally scrubbed — the trust prompt for a plugin with
  this capability should make "can read agent conversation contents" explicit. Add
  `agents.transcriptExport` to the permission vocabulary rendered by the phase-5 trust prompt
  (docs/third-party/phase-5-install-ux.md) with exactly that wording.
- `listCompleted` with `afterSessionId` exists for the reconcile pattern
  (phase-2-lifecycle-capabilities.md): consumers page forward from their own high-water mark on
  boot, then subscribe to `AGENTS_ON_SESSION_STATUS` for live completions.
- `headShaAtEnd`: best-effort observed HEAD of the task's worktree at session end (the agents
  plugin knows the task; core knows the worktree). This is what lets an uploader set
  `commit_sha` without inventing git archaeology. Null when unknown; consumers can also
  correlate later observed commits (phase-2 `CORE_ON_COMMIT_CREATED`) with `endedAt` when they
  want tighter linkage — document that as a consumer heuristic, not a capability promise.
- Structured-clone-safe, async, no streams — a transcript is bounded text; if sessions someday
  exceed sane string sizes, add `read` pagination then (YAGNI now, note the ceiling).

## What this phase deliberately does not do

- **No git-trailer injection** (`AI-Session` trailers in commit messages). SmolForge supports
  linkage by explicit `commit_sha` upload; trailers would require intercepting commit creation,
  including commits made by agents in PTYs, which phase 2 already declined to do. If demand
  materializes, it is a repo-level git hook feature, not a capability.
- **No raw provider-format export.** One normalized shape. A consumer needing Claude-native
  JSONL is reading the wrong product's files.
- **No live streaming of in-flight sessions.** Completed sessions only; live views already have
  the session surfaces.

## Steps

1. JSONL rendering of the normalized event rows + shape doc + version header. Snapshot-test the
   rendering against a fixture session.
2. Capability implementation in `plugins/agents/src/node`, registered at init; meta assembled
   from existing session rows; `headShaAtEnd` recorded at session-end transition (one new column
   on the session table, nullable, backfilled null).
3. Contract exports + plugin-api export of the types/id (d.ts snapshot update).
4. Permission vocabulary entry + trust-prompt wording ("can read agent conversation contents").
5. Tests: list pagination via `afterSessionId`; read of a fixture session matches snapshot;
   unknown session → null; capability absent when agents plugin disabled (degrades, no throw at
   resolve time).

## Exit criteria

- A test consumer resolves the capability, pages completed sessions, reads one as versioned
  JSONL with correct meta, and sees `headShaAtEnd` populated for a session that ended in a
  worktree with commits.
- The JSONL shape is documented in the agents plugin's docs and stable under the snapshot test.
- `pnpm lint`, suites, boundaries test green.
