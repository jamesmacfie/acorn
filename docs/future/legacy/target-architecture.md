# Target architecture

Date: 2026-09-21. Status: accepted review direction; implementation proposal.
Read [context](./context.md), [findings](./findings.md), and [refused alternatives](./refused.md).

## Retain the runtime topology

Keep the Node authoritative for execution and persisted product state. Keep custody authoritative for
fleet membership, bearer tokens, certificate pins, plugin trust, and supervision. Keep the desktop
shell responsible for native operations and the renderer for presentation. The terminal host composes
the same client and custody contracts in one process without granting rendering code custody access.

Keep compiled plugins and permission-scoped loaded workers. Keep descriptors for small host-rendered
facts, remote trees for portable UI, and frames for browser-specific rendering. These represent
different trust and rendering requirements, not historical versions of one implementation.

The target dependency direction is:

```text
application composition → runtime libraries and plugin entry points
plugin implementation  → plugin API facade + protocol + peer plugin contracts
runtime libraries      → shared host contracts, never plugin implementation or named route
plugin contract        → portable types/pure functions, never its server or client implementation
```

## Ownership decisions

| Concern | Owner after implementation | Reason and precedent |
| --- | --- | --- |
| Identity, tasks/projects/worktrees, connections, permissions, scheduler, transport | Core | Shared resource ownership already documented in the architecture overview. |
| Generic data sources, saved queries, dashboard shaping | Shared core facilities | Node sampling and client rendering need the same semantics; plugins supply data. |
| Workflow definitions, forms, runs, steps, accounting projections | Workflows | Follow plugin-owned route/type contracts already used by Docker and GitHub. |
| Managed session types and attention adapter | Agents | Core only needs the resulting attention snapshot; Agents already invokes the adapter. |
| PTY session state, fetch/send routes, active tab, lifecycle capture data | Terminal | Several consumers need a projection, not authority over Terminal's store. |
| Review records, target selection, capture, export | Findings | The existing review controller is the extension seam; no migration coordinator remains. |
| Memory content validation, library files, approval write receipts | Memory | Findings coordinates review; only Memory knows how to apply its content. |
| Notes and note routes | Notes | Remove Memory's alternate ownership path. |
| Optional feature collaboration | Producer contracts and contributions | Follow Agents' completion event/read pair and existing hooks. |
| Process environment, startup barriers, boot/drain order | Composition | Runtime adapters are legitimate root dependencies; feature policy is not. |

### Findings submission and lifecycle

Extend the existing review-target controller with `submitProposal`. Bind its target ID in the
controller closure; the caller supplies title, scope, and target-validated payload, not another target.
Findings creates the observation, candidate, and review bundle together and returns their identifiers.
Memory's tool supplies a memory-change payload. Submission is not application of the change.

The compiled Memory tool's authenticated invocation supplies session provenance after checking the
task/session association. Carry that context through a host-only submission adapter, never ordinary
plugin-supplied RPC arguments. Other target submissions receive host-stamped plugin provenance and
cannot claim an agent identity. Revoke the controller on unload and revalidate scope at submission.

Preparation receives an explicit target ID. The target contributes its schema and generation
instructions; Findings owns bounded source selection, orchestration, and candidate revisions. Memory
chooses `memory:change` in its own command/UI. Findings settings add a selected automatic target ID;
fresh automatic preparation remains off, with no selected target. Enabling it requires a registered
target. Freeze that target in preparation/retry input and report target unavailability explicitly.
Bundle notices use generic Findings review wording/kind and the existing findings-bundle destination,
not Memory-specific labels. Keep the exact payload/revision checks, device-only
approval, and durable application receipt. On absent Findings, proposal tools return unavailable;
manual owner-authored library edits remain available.

Completion capture follows the Agents event/read precedent: producers emit a stable completion
identifier, and Findings reads bounded data through the producer's capability. Resolve capabilities
at call time and tolerate a disabled consumer. Do not include full transcripts in broadcast frames.
Workflow handoff notes and terminal retained output remain owned by their producers.

Terminal snapshots the bounded completion input before emitting the event. Retain at most 256
snapshots of 16 KiB each for 60 seconds; expired, evicted, or pre-restart input returns unavailable.
Findings persists received input in its checkpoint. This preserves a read window without inventing a
durable transcript store or promising PTY evidence recovery after a restart.

Archive is different: the task-check cleanup path must await bounded capture before Terminal or
worktree teardown. Add a Terminal-owned pre-teardown hook through the existing hook mechanism, with
task/session identity and a permission-scoped read capability for retained output. The trusted archive
producer also reads the bounded Git diff before teardown; the loaded Findings worker receives that
snapshot, not extra Git/process authority. Findings handles the hook and owns observation construction.
Use best-effort capture with a recorded failure; it must not turn
an optional Findings plugin into a requirement for archiving. Keep existing archive safety checks.

Terminal also owns a launch-context contribution point. Memory supplies launch text through that
point, removing the mutual dependency mediated by composition. Apply existing ordering and byte
budgets; contributors do not receive PTY handles or send authority.

### Shared client contracts

Core notification delivery accepts its existing small attention snapshot. Agents and Terminal each
map their own session records to it. Make the snapshot's origin a plugin ID plus opaque session ID;
keep shared attention states, not the complete AgentSessionKind domain vocabulary.

Add a narrow, disposable client session-source registration to the host. This is justified by send
pickers, quit concerns, and tab/navigation consumers. Each source supplies node-scoped summaries with
source ID, session ID, task ID, title, running state, and optional focus/send actions. Core does not
fetch provider routes. Terminal owns its full store and publishes these summaries; reset subscriptions
on node change and unregister actions on plugin disposal. Core aggregates sources and handles empty
sources. Do not create a second session database or a general dependency-injection container.

For this programme, this live client registration is compiled-tier, matching the existing client
registries. Do not expose raw callbacks to loaded workers. Loaded plugins continue to use the existing
descriptor/command/attention contributions; adding a loaded session carrier requires a concrete use
case and is outside this reset.

Remove `sendToAgent` from the core task bridge. Consumers call the selected session source's send
action, preserving `now`, `after-ready`, and `draft` semantics. Archive/task APIs remain core-owned.

Core's promotion form retains create/attach task mechanics. Replace its workflow-specific prop with
one optional action contract: rendered content, readiness, action label, and an async `onTaskReady`
callback. Workflows' existing StartFromItemHost owns definition selection, typed input parsing, and
starting the run. A failed start keeps the created/attached task selected so retry cannot duplicate it.
The ordinary promotion flow supplies no action and behaves as before.

### Protocol placement and public types

Move workflow domain types to Workflows' `contract/`, and agent domain types to Agents' `contract/`.
Move the pure shared agent tool-tone function to Agents' contract too; Changes imports that contract,
not Agents' client implementation. Keep core authorization types/functions in a dedicated tool-policy
protocol module. Separate task/archive/worktree/run-target types from Terminal session/PTY frames.

Core owns the WebSocket envelope and channel dispatch. A Terminal-owned channel handles its PTY frame
payload. Avoid a central union that imports every plugin payload. The host's generic channel boundary
must validate the envelope; the plugin validates its payload where input is untrusted.

Keep the published plugin declaration package free of runtime dependencies. Portable configuration
DTOs replace parity holes for task run configuration and project configuration/setup. Opaque database
or framework handles remain intentionally opaque. Add bidirectional contract assertions and loaded
worker fixtures at the actual RPC boundary; TypeScript assignability alone cannot verify call modes.

## Simplification rules

- One supported input representation after cutover. No migration aliases or production fallback stores.
- Keep independent plugin IDs, versions, and dependencies. Version ranges describe compatibility;
  they do not mean the host emulates previous APIs.
- Keep lifecycle rollback and explicit disposables. Do not rewrite every singleton registry merely
  to resemble a dependency-injection framework. Sequential restart/unload tests are the requirement;
  multiple concurrent Node runtimes in one process are not added here.
- Close public export maps with explicit module paths, following Protocol. Do not export private
  modules merely to satisfy an existing deep import; move that caller to its owning public contract.
- Extract pure logic where it separates responsibilities. Do not split every long file or add an
  interface around a single function without a boundary it protects.
- Name encrypted values, projections, commands, events, hooks, and capabilities for what they mean.
  Avoid retaining a misleading name just because a migration once needed it.

## Verify before building

- Confirm every moved type's importers and remove reverse edges rather than widening an export map.
- Check node switching, startup, disable/reload, and partial failure for every new registration.
- Test ordinary task promotion and workflows together after separating the form.
- Reuse existing permission, hook, and disposal mechanisms; do not create parallel lifecycle systems.
