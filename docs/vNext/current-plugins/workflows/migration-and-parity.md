# Workflows migration and parity

**Status:** Normative current-plugin migration<br>
**Requirement prefix:** `CUR-WF`

## V1 coupling removal

| V1 behavior/coupling | Required V2 replacement |
| --- | --- |
| runs/steps live in core SQLite | isolated Workflows database and outbox |
| Workflows client lives under Agents | Workflows-owned Client contracts/artifacts |
| command palette imports Agents workflow client | manifest command/query contribution |
| Agents sidebar imports workflow API/types | Workflows task-activity/attention contribution |
| runner imports Agent profiles/headless process | `acorn/agents.session-execute@2` |
| runner calls Terminal runtime | optional `acorn/terminal.run-targets@2` |
| checks policy queries GitHub/core tables | provider `policy.evaluate@2` |
| runner writes Notes implementation | Workflows handoff resource plus optional Notes capability |
| runner calls Memory callback | optional idempotent Memory review capability |
| child tasks written to core table | core task saga |
| context assembled through private loopback HTTP | context broker snapshots |
| app composition registers function handlers | manifest capability providers |
| Client 30-second trigger poller | supervised Node scheduler |
| restart blindly requeues running steps | operation-outcome reconciliation |
| raw resume command returned to Client | typed Agents/Terminal navigation intent |

`CUR-WF-124` No core, Agents, Terminal, GitHub, Notes, Memory, profile or other plugin module may
import a Workflows implementation, and Workflows may import only its SDK plus its own code.

`CUR-WF-125` V1 `workflow_runs`, `workflow_steps`, preferences, trigger state, client caches and API
tokens are left untouched and not imported. V2 creates a new isolated database with no history.

`CUR-WF-126` Repository `.acorn/workflows/*.toml` files remain repository content and are discovered
after the task/checkouts are configured and exact config trust is granted. V1 owner-level
`~/.acorn/workflows` files are not copied into the V2 Node data root.

`CUR-WF-127` The allowed V2 configuration importer records repository/workspace relations only. It
does not start, resume, infer or migrate a run from V1 rows or files.

## Fresh-install sequence

1. Installer verifies the WASI and declarative Client artifacts, migrations and dependency solution.
2. Node opens an empty plugin database, registers the scheduler and scans no task until requested.
3. Electron registers settings, palette, task activity, attention and notices.
4. Selecting a task discovers repository definitions and surfaces trust/validation/dependency state.
5. Manual start names one definition revision and creates a durable run checkpoint.
6. Background triggers remain disabled until the owner approves their exact policy.

`CUR-WF-128` Installation alone MUST NOT run a definition, poll a provider, create a child task,
open a Terminal, invoke an Agent, approve a gate or copy V1 authority.

## Definition and runtime parity

`CUR-WF-129` V2 preserves repository-over-owner definition layering, TOML parsing, visible malformed
file rows, static sub-workflow expansion, cycle rejection, frozen-at-start definitions and
repository config trust.

`CUR-WF-130` It preserves workflow name/posture/trigger, step names/kinds/profile/model/prompt/
schema/policy/iterations/requires-run/child/join/branches, tool allow/risk and all five budget
fields.

`CUR-WF-131` Validation preserves duplicate/unknown kind/profile/policy rejection, explicit
preceding fan-out joins, forward-only decision targets, earlier-successful output templates and
narrowing-only tools/budgets; V2 additionally imposes explicit file/expansion/schema bounds.

`CUR-WF-132` Built-ins preserve `agent`, `gate-human`, `gate-policy`, `ci-loop`, `fan-out`, `join`
and `decide`; `checks-green`; four concurrent Agent operations; eight CI turns; twelve child tasks;
all-or-nothing join; tool-free decide; and `safety-rail` distinction.

`CUR-WF-133` Agent steps preserve profile/model/schema, structured capture, usage/cost/session
relation, run-scoped context and handoff. Managed Claude/Codex history remains visible through
Agents; raw profiles use declared profile capabilities.

`CUR-WF-134` `requires_run` preserves start/status/URL injection behavior through Terminal. Missing
or denied Terminal fails only the affected step with a typed dependency error.

`CUR-WF-135` Fan-out preserves normalized unique child branches, parent task relation, lazy
worktree, narrowed child policy, parallel bounded execution and child-task navigation without
direct core table writes.

`CUR-WF-136` Human gate approve/reject, policy re-derivation, named-output template, forward branch
skips, cancellation, kill, terminal handoff exclusion and optional Memory review remain durable.

`CUR-WF-137` V2 intentionally improves restart semantics: it never blindly reruns an operation with
unknown side effects. Known idempotent operations resume; unknown outcomes require recovery review.

`CUR-WF-138` V2 intentionally improves availability: the Node runner and approved triggers continue
when Electron is closed. This does not broaden authority, auto-approve gates or bypass notification/
budget policy.

## Exact Client parity

`CUR-WF-139` Settings retains its V1 page position and read-only explanation, task-scoped
definition list, source/posture markers, ordered step summary, visible Problems section, empty
state and Rescan action.

`CUR-WF-140` The command palette retains `Workflow: <name>` rows with step-count hints, visible
definition errors, task requirement and inline start/trust errors.

`CUR-WF-141` Workflow activity remains visible in the task's combined Agents/Terminal/Workflow
roster with status glyph/text. Human gates retain Approve/Reject actions and exact run/step targeting.

`CUR-WF-142` Resumable work retains open-in-Agent or open-in-Terminal behavior through typed
intents. Missing profile/session capability gives the V1-equivalent explanatory error without a
constructed command line.

`CUR-WF-143` Gate/run completion notices and status refresh remain push-driven. V2 adds explicit
failed/safety/recovery attention and durable replay without changing successful-run navigation.

`CUR-WF-144` No Client uses terminal capability as a proxy for Workflow availability. Remote
Workflows works in Electron whenever the Node and Workflows declarative Client artifact negotiate
successfully.

## Fleet, failure and lifecycle

`CUR-WF-145` Multi-Node activity, attention and search merge projections while retaining Node
labels and partial-failure state. Every start/gate/cancel/kill targets the run's owning Node only.

`CUR-WF-146` Disconnect makes cached runs read-only/stale, leaves Node execution running, never
buffers a gate/cancel/start and resynchronizes from events or authorized snapshot.

`CUR-WF-147` A replay cursor older than retention replaces affected definition/run/step/gate
projections at the snapshot sequence and deduplicates notices. It never reruns a step.

`CUR-WF-148` Definition deletion prevents new starts but preserves frozen active/history runs.
Dependency removal blocks pending affected steps, cancels active calls according to grant policy
and leaves safe cancel/gate/history operations.

`CUR-WF-149` Uninstall cancels/drains active runs as chosen, retains or purges plugin history,
removes Client contributions and scheduler registration, and leaves repository files/dependency
resources untouched.

`CUR-WF-150` Reinstall discovers definitions afresh and may reopen retained history by URI. It does
not automatically resume cancelled/failed/unknown runs or re-enable triggers.

`CUR-WF-151` Update/rollback proves frozen active definitions and provider contracts remain
compatible or waits for terminal checkpoints. Schema restore and artifact generation switch as one
health-gated transaction.

## Release acceptance

`CUR-WF-152` Golden tests load all valid/invalid V1 TOML fixtures and compare definitions, errors,
sub-workflow expansion, validation, tools, budgets and built-in semantics.

`CUR-WF-153` State-machine tests compare V1 successful/gated/failed/safety/cancelled journeys and
exercise every crash point, unknown provider outcome, branch, fan-out child and cancellation race.

`CUR-WF-154` Client parity tests compare fresh V1/V2 settings, palette, activity roster, gates,
resume links, notices, errors, empty state and task navigation with mouse, keyboard and screen reader.

`CUR-WF-155` Background tests close every Electron Client and prove approved Node triggers/runs
continue, gates wait, budgets stop work, notices appear once on reconnect and disabled triggers do
nothing.

`CUR-WF-156` Security tests attempt arbitrary submitted graphs, malicious TOML/schema/template/
outputs, config trust bypass, tool/budget widening, trigger flood, confused deputy, cross-Node IDs,
secret leakage and WASI/database escape.

`CUR-WF-157` Dependency matrix tests cover Agents, Terminal, profiles, GitHub policy, Notes and
Memory present/absent/denied/incompatible at validation, start, mid-step, restart and update.

`CUR-WF-158` Boundary tests reject shared SQLite, direct imports, private HTTP, raw process/terminal,
core task writes, provider table reads, ambient files/network/secrets, Client polling and raw
resume commands.

`CUR-WF-159` Workflows is complete only when every V1 table field, definition field, route, client
surface, registry contribution, built-in, WebSocket notification/progress frame, restart behavior
and dependency edge has a V2 contract or explicit safety/availability change in these five files.
