# Findings: advisory records with a human disposition

Status: proposal, 2026-08-29. Not started.

This file records what acorn should take from the harness-engineering material at
[ai-literacy-superpowers](https://habitat-thinking.github.io/ai-literacy-superpowers/plugins/ai-literacy-superpowers/explanation/harness-engineering/)
and what it should refuse. The short version: one core entity, the finding, joins six things acorn
already has (notes, memory, workflows, schedules, audit, agent tools) into the loop that material
describes. Almost everything else on that site is a consumer of that entity, and nothing on it needs a
new file format, a new agent framework, or a second knowledge store.

## What the material says, without its vocabulary

Thirty pages reduce to four ideas.

1. **A rule is a row with an enforcement status.** Rule, how it is checked (`unverified`, `agent`,
   `deterministic`), what checks it, how often. The status is tracked, and the gap between "declared"
   and "actually checked" is made visible on a schedule. Movement is mostly upward (progressive
   hardening) but the site's own later page (determinacy calibration) admits rules move down too, and
   that "left unchanged, on purpose" is the most common and least recorded outcome.
2. **Three loops at three timescales.** Edit time is advisory. Merge time gates. A schedule
   investigates and reports. Outer-loop reports feed the inner loop's context.
3. **Advisory records with a human disposition.** An agent that only reads produces a record. A person
   sets its disposition (`accepted`, `rejected`, `deferred`, `promoted`, `revisit`, `dropped`, the
   set varies by record type) and writes a rationale. The site calls these agents sentinels and gives
   them a three-part signature: no write tools, output is a record a human disposes of, and each
   claim is flagged `observed`, `inferred`, or `asked`. The point is that a person typing the
   disposition is the mechanism. Nothing automates it.
4. **Compound learning.** Reflections accumulate. A periodic review promotes the recurring ones into
   context or rules. Capturing and promoting are deliberately separate steps so one surprise does not
   become a rule.

The remaining pages are one of those four applied to a gate: adversarial review (objections before
plan approval and before merge), decision archaeology (implicit choices, six lenses, soft gate at plan
and hard gate at merge), cadence governance (slicing a task so each slice is one decision), cost
estimation (a range before, an actual after, the actuals sharpen the next range), fitness functions
(a scheduled numeric snapshot where three declining readings is a signal and one is noise), and
regression detection (is anyone still doing the periodic work).

## What acorn already has

Closer than a first read suggests. The skeleton is there; it is six plugins that do not share an
object.

| Site concept | What acorn has | The gap |
| --- | --- | --- |
| Promoted conventions, reviewed knowledge | `plugins/memory`: proposals, human acceptance, `type` (convention, decision, fix, feedback, ...), `originSessionId`, `commitSha`, `supersededBy`, recall stats. Project entries live in `.acorn/memory/` and are reviewable in a PR. | No raw layer beneath it. No "this entry is a rule that something checks". |
| Advisory records | `plugins/notes`: `author: 'agent' \| 'workflow'`, kind `'scratch' \| 'finding'`. Workflow handoffs are findings already. | A finding has no disposition, so it cannot be adjudicated, blocked on, or promoted. |
| Outer loop | The node-owned scheduler ([schedules.md](../schedules.md)): plugin-declared, runs whether or not anyone is looking. | Nothing declared there writes a record anyone disposes of. |
| Middle loop | Workflows: `gate-human`, `gate-policy`, `workflows:policy` extension point. | The gates know about checks and postures, not about open records on the task. |
| Affordance inventory and audit trail | The agent-tool registry with `risk` tiers and per-tool prefs; the manifest `permissions`; the closed-verb `audit` table. | Nothing missing that this design needs. |
| Sentinel (read-only advisor) | `plugin_request`: an agent asks, a human decides, the decision is an audit row. Tool tiers can already express "no write, no execute". | No named preset, and no record the advisor can write except a note. |
| Context engineering | Context sections with a byte and token budget. | Open findings are not a section. |
| Deterministic rung, applied to acorn itself | `tools/arch/boundaries.test.ts` with shrinking baselines. | Nothing reports the baseline counts over time. |

## The entity

A **finding** is a claim about a task, project, or workspace, produced by an agent, a workflow step,
a scheduled job, or a person, that a person disposes of. It is core-owned, in the same spirit as
`core.tasks` and `core.projects`: three plugins read it (memory, notes, workflows) and
`packages/*` cannot import `plugins/*`, so it cannot live in any one of them. Plugins reach it through
`ctx.core.findings` and get projections, never the row.

```ts
type Finding = {
  id: string
  // Where it points. Exactly one of task, project, workspace; the others derive.
  scope: { taskId?: string; projectId?: string; workspaceId: string }
  // Who produced it and from what. sessionId for an agent, runId + stepName for a workflow,
  // scheduleId for a job, 'device' for a person.
  origin: { kind: 'session' | 'workflow' | 'schedule' | 'device'; ref: string }
  // A core kind, or a plugin's qualified `<pluginId>:<kind>`, the same rule step kinds use.
  kind: 'objection' | 'choice' | 'estimate' | 'drift' | 'reflection' | 'gc' | `${string}:${string}`
  title: string
  body: string              // Markdown, bounded
  claim: 'observed' | 'inferred' | 'asked'
  severity?: 'low' | 'medium' | 'high' | 'critical'
  value?: number            // for drift and estimate: the snapshot reading or the range midpoint
  evidence?: Array<{ label: string; ref: string }>   // a path, a sha, a URL, a session id
  disposition: 'pending' | 'accepted' | 'rejected' | 'deferred' | 'promoted' | 'dropped'
  rationale?: string        // required non-blank on every disposition except pending
  disposedAt?: number
  promotedTo?: { kind: 'memory' | 'policy' | 'schedule'; id: string }
  createdAt: number
}
```

Four rules hold the shape together.

**Disposition is written by a device principal only.** No agent tool sets it, no workflow step sets
it, no schedule sets it. The route is `POST /v2/core/findings/:id/dispose` behind the device gate, and
it refuses a blank rationale. This is the one rule the site is adamant about, and the reasoning holds:
if an agent can close its own objection, the record is theatre. `plugin_request` already works this
way in acorn, so this is a second instance of an existing pattern, not a new one.

**A finding is immutable after creation, except its disposition.** Its author may withdraw a pending
finding it created in the same session (a `withdrawn` state folded into `dropped` with
`rationale: 'withdrawn by author'`). Nothing edits the body. A correction is a new finding.

**Kind is closed for core, open for plugins.** The six core kinds are the ones the design below reads
with meaning. A plugin that wants `rollbar:regression` declares it and owns its rendering, the same
way `http:request` is a step kind. The runner-side lesson from step kinds applies: a qualified kind is
validated by its plugin at load, not by core at write.

**`value` is a number, not a JSON blob.** Fitness functions and estimates both want a reading, and
"three consecutive declining readings" is a query over one column when it is a column. The full
report goes in `body`.

## The MCP surface

This is the part that makes the design useful to any harness acorn launches, and the reason to do it
in core rather than in a pane. The tools go through the one agent-tool registry
([agent-tools.md](../agent-tools.md)), so they are projected to the stdio MCP server, the harness
HTTP route, and the renderer without a second implementation.

| Tool | Tier | What it does |
| --- | --- | --- |
| `findings_record` | `write` | Create a finding on the calling task. `kind`, `title`, `body`, `claim`, optional `severity`, `value`, `evidence`. Scope is derived from the task token, never supplied. `origin` is the session, stamped by the node. |
| `findings_list` | `read` | Open or all findings for the calling task, or for its project when `scope: 'project'`. Filter by `kind` and `disposition`. Bounded. |
| `findings_get` | `read` | One finding with its disposition and rationale. |
| `findings_withdraw` | `write` | Drop a pending finding this session created. Nothing else. |

There is no `findings_dispose` tool, and there should never be one. That absence is the design.

Two things follow for the harness side. First, a `reflection` finding is what a session writes at its
end when the launch profile asks it to (`--append-system-prompt` already tells Claude Code to call
`task_context` first; the same mechanism tells it to call `findings_record` with `kind: 'reflection'`
last). Second, a session that reads `findings_list` at start sees the accepted objections and choices
from earlier sessions on the same task, which is the "Groundhog Day" fix the compound-learning page
is after, without a new context mechanism: findings also register a context section, so the push path
gets them too.

The `write` tier is on by default (`TOOL_TIER_DEFAULTS`), so `findings_record` is available to every
installation on upgrade. That is right: a record a person disposes of is not a side effect anyone
needs protecting from, and an owner who disagrees turns the tool off per tool.

## What each existing piece does with it

**Notes.** Kind `'finding'` rows stop being notes. Workflow handoffs become `objection` or `choice`
findings on the parent task with `origin.kind: 'workflow'`, and the `workflow-handoffs-<runId>` note
goes away. Seeded `'scratch'` notes stay notes; they are snapshots, not claims.

**Memory.** A proposal is a finding whose promotion target is a memory entry. The memory pane's
accept action becomes a disposition of `promoted` with `promotedTo: { kind: 'memory', id }`, and the
memory plugin's `proposals` table and its two routes go. `memory_write` keeps its name but records a
finding underneath, so no harness prompt changes. The end-of-session review hook writes a
`reflection` finding instead of a proposal directly, which separates capture from promotion, the one
distinction the site insists on. `supersededBy` on the memory row plus `promotedTo` on the finding is
the audit of how a convention came to exist.

**Memory conventions gain an enforcement field.** Entries of `type: 'convention'` get
`enforcement: 'unverified' | 'agent' | 'deterministic'` and `checkedBy?: { kind: 'policy' | 'schedule';
id: string }` in their frontmatter. That is the HARNESS.md constraint row, living where conventions
already live, in the repo, reviewable in a PR, and already read by agents at session start. There is
no HARNESS.md file to parse. A scheduled job (`findings:sync`, weekly, off by default) reads every
convention, asks whether its `checkedBy` exists and ran in the window, and writes one `drift` finding
per convention that failed the question. The "constraints enforced: N of M" status line is a query.

**Workflows.** `gate-human` blocks while the run's task has a `pending` finding of kind `objection`
or `choice` with `severity >= high`, and the gate's pane shows them with dispose controls. A new
built-in policy `findings-clear` for `gate-policy` gives an autonomous run the same rule without a
person. Both are readers of `ctx.core.findings`; neither writes.

**Schedules.** A fitness function is a schedule whose handler writes a `drift` finding with a `value`.
The first three are already counted somewhere: the boundary-test baselines, the deep-import count into
`@acorn/plugin-api/testkit`, and the size of the largest file in `packages/`. Declining for three
consecutive readings is what the findings pane surfaces; a single reading is stored and not shown.

**Events.** `findings:changed` joins the core catalogue with the one-sentence entry the catalogue
requires. Dashboards can draw a collection from it, and the agent pane can badge a task.

**Audit.** `findings.disposed` joins the closed verb set, carrying the disposition, the finding kind,
and whether a promotion happened. Creation is not audited; it is the record.

**Client.** One task pane, Findings, grouped by disposition then kind, with a dispose form whose
submit is disabled until the rationale has content. One rail marker for pending findings of
`severity >= high`. The memory pane's proposals tab becomes a filter on this pane.

## The sentinel preset

A sentinel is not a new agent type. It is an agent profile launched with a tool ceiling of
`read` plus `findings_record` and `findings_withdraw`, and a prompt that says what to look for. The
profile ceiling mechanism exists ("a workflow or profile ceiling, which can only narrow the tool list
further"), so this is a named preset in Settings → Agents, not a type. Three prompts cover the site's
three read-only reviewers: objections (adversarial review, before plan approval and before merge),
choices (the six lenses of decision archaeology), and slicing (one finding per proposed slice, kind
`choice`, on the parent task, with child tasks created only after a person accepts). Whether those
prompts ship in acorn or as a plugin's `harnesses` entry is a packaging question for later.

## What not to build, and why

- **A HARNESS.md file or parser.** The memory folder is that document, with better provenance.
- **A sentinel framework.** Read-only is a tool ceiling acorn already has.
- **Cost estimation first.** Per-session usage snapshots exist. An `estimate` finding with a `value`
  before a task and a comparison after is cheap once findings exist and pointless before. Do it fourth.
- **Carpaccio as a feature.** `core.tasks.createChild()` and fan-out already model slices. A slicing
  record is a `choice` finding. What is missing is the rule that children are created after
  acceptance, and that is a workflow, not a schema.
- **Watching the verifier.** The site itself says human-state advisories cannot ethically become a
  gate, and acorn should not collect time-of-day approval data about its owner at all. Refused.
- **Governance audit and semantic drift.** Aimed at organisations with a compliance function. acorn's
  owner is one person or a small team; the falsifiable-constraint rule (what is observed, what is
  evidence, what happens on failure) is worth keeping as the template for a convention's body, and
  nothing more.
- **Regression detection as a separate mechanism.** "Four weeks with no reflections" is a query over
  findings by `createdAt` and `kind`. It is a row in the findings pane's summary, not a system.
- **A second knowledge store or a per-record folder layout** (`docs/superpowers/objections/`). Findings
  are rows in `core.sqlite`; only what is promoted becomes a file, and that file already exists.

## Order of work

1. **The entity.** Table, `ctx.core.findings` with `record`, `list`, `get`, `dispose`, `withdraw`;
   the device-gated routes; the four agent tools; `findings:changed`; `findings.disposed` on the audit
   trail; the context section. Migrate notes' `'finding'` rows and memory's proposals onto it, delete
   both sources. This is the seam; everything after is a consumer.
2. **Gates.** `gate-human` reads pending high-severity findings; `findings-clear` policy; the Findings
   task pane and rail marker.
3. **Reflection.** The end-of-session hook writes a `reflection` finding; the launch prompt asks the
   harness to record one. Memory's accept becomes a promotion.
4. **Conventions with enforcement.** The frontmatter fields, the `findings:sync` schedule, the
   summary line in the memory pane.
5. **Fitness functions.** Three schedules writing `drift` with a `value`, starting with the counts
   the arch test already keeps.
6. **Estimates.** `estimate` findings before, usage snapshot after, the comparison in the pane.

Each step is shippable alone and each leaves the previous one useful without it.

## Open questions

- **Rationale on `deferred`.** The site requires a rationale on every disposition. A deferral with
  "later" as its reason is honest and useless. Proposed: require it, accept anything non-blank, and let
  the GC-style query ("deferred for more than 60 days") do the nagging.
- **Project-scoped findings from a task token.** `findings_list` with `scope: 'project'` lets a
  session see another task's accepted findings on the same project, which crosses the task-scope rule
  in [security.md](../security.md). Accepted and promoted findings are project knowledge in the same
  way memory entries are, and `memory_search` already crosses it. Pending ones do not. Proposed: a
  task token reads project-scope findings only where `disposition in ('accepted', 'promoted')`.
- **Where the sentinel prompts live.** Core, or a `harnesses` contribution from a plugin. Leaning
  plugin, so the prompts can be edited without a release.
- **Whether `value` should carry a unit.** For three schedules, a `label` in `evidence` is enough.
  Revisit at the fifth.

## Verify before building

- `packages/node-core/src/main/core/index.ts` still exposes `CoreServices` with `tasks`, `context`,
  and `projects` as the pattern to copy for `findings`.
- `plugins/notes` still distinguishes kind `'scratch'` from `'finding'`, and `plugins/workflows`
  still writes `workflow-handoffs-<runId>` notes.
- `plugins/memory/src/shared/api.ts` still has `memoryProposalsRoute` and
  `memoryResolveProposalRoute`; the `memories` schema still has `supersededBy` and `originSessionId`.
- `plugins/workflows/src/main/workflowBuiltins.ts` still dispatches `gate-human` on posture alone and
  `BUILTIN_POLICIES` is still `['checks-green']`.
- `TOOL_TIER_DEFAULTS` in `@acorn/protocol/toolPermissions.ts` still allows `write` by default.
- `packages/protocol/src/nodeEvents.ts` still lists seven `<noun>:changed` entries.
- The agent profile ceiling can still narrow to an explicit tool list rather than a tier.
