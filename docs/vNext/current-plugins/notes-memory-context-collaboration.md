# Notes, Memory and Context collaboration contract

Status: **Normative**<br>
Requirement prefix: `CUR-KNOW`

This document is the cross-plugin contract. The individual plugin specifications remain
authoritative for their private behavior.

## 1. Current behavior and authoritative state

V1 has a sound product distinction but an unsound implementation boundary: Notes is ephemeral
working context, Memory is durable reviewed knowledge, and Context is a projection. Yet Memory
constructs/exports NotesStore, Context imports both UIs/clients, core builds section implementations,
and shared application wiring coordinates them.

- **CUR-KNOW-001:** V2 MUST preserve three independent ownership domains: Notes owns working notes,
  Memory owns durable memories/proposals/index, and Context owns neither.
- **CUR-KNOW-002:** Promotion flows one way by explicit owner command: Notes → Memory proposal →
  accepted Memory. Memory MUST NOT mutate Notes; Context MUST NOT mutate either except through their
  public actions.

## 2. Current UI, routes, events, contributions and dependencies

Today the Context pane embeds `MemorySection`, jumps directly into Notes, and reads one core
`TaskContext`; Notes/Memory renderer routes share `KnowledgeBridge`; agent tools are wired by app
code; launch injection directly assembles both stores; changes are refreshed by local calls, not
durable events. This coupling prevents independent installation and remote discovery.

## 3. Target classification

Notes, Memory and Context are separate bundled Acorn Verified plugins. Notes and Memory have WASI
Node components and isolated databases; Context is declarative/platform-assembly policy. None is
System. Default profile installs all three, but each MUST activate in meaningful degraded mode when
an optional peer is absent.

- **CUR-KNOW-003:** Required dependency cycles are prohibited. Context optionally depends on Notes
  and Memory exports; Notes and Memory do not depend on Context.
- **CUR-KNOW-004:** Memory MAY optionally depend on Notes only for the explicit promotion
  capability. That edge is not required for Memory activation and grants no Notes database access.

## 4. Node, Electron, native-host and renderer split

Core Node hosts the context-section broker and Agents attachment/injection broker. Each provider
answers authorized typed calls from its own store. Electron composes contributions into Context
slots through installed manifests; absence uses generic fallback. Navigation intents are shell
messages, never client imports.

```text
Notes ──exports section/read/promotion-source──┐
                                               ├─> core context broker ─> Context ─> Agents snapshot
Memory ─exports index/get/proposal-view────────┘
Notes ──explicit promote command──────────────> Memory proposal capability
```

## 5. Manifest, capabilities, permissions and dependencies

| Provider | Export | Consumer |
| --- | --- | --- |
| Notes | `dev.acorn.notes.context-section.get.v1` | core Context broker |
| Notes | `dev.acorn.notes.note.read.v1` | Agents/authorized UI |
| Notes | `dev.acorn.notes.promotion-source.get.v1` | Memory optional promotion |
| Memory | `dev.acorn.memory.context-section.get.v1` | core Context broker |
| Memory | `dev.acorn.memory.entry.get|search|list.v1` | Agents |
| Memory | `dev.acorn.memory.proposal.create.v1` | Agents, optional Notes promotion |
| Context | `dev.acorn.context.selection.capture.v1` | Agents UI |

- **CUR-KNOW-005:** Calls preserve authenticated device/delegated agent, target Task/Workspace,
  granted scope and deadline. Callee evaluates its own authorization and cannot use a caller's
  identity to expand authority.
- **CUR-KNOW-006:** Context never receives the Memory full body via the index contract. Agents must
  call `entry.get` explicitly.

## 6. Queries, commands, capabilities, events and streams

### Section contract

Every provider returns
`{sectionId,label,revision,sensitivity,defaultIncluded,budget,items,compact,omitted,absent}`.
Provider owns item semantics/compact formatting; core enforces global caps and independence;
Context presents and selects. Notes section is max 10 × 2,000 bytes truncate-tail. Memory is max 30
index-only.

### Invalidation

Notes body/inclusion/create/delete facts invalidate Notes section; Memory entry/proposal resolution/
reconcile facts invalidate Memory. Core emits authorized `context.section.invalidated` with
Task/section/revision only. Client refetches exact sections and recomputes sync digest.

### Promotion

`dev.acorn.memory.proposal.create-from-note.v1` accepts Note URI, expected revision, target Task,
Memory scope/name/type/description and optional body selection. Memory synchronously calls the
declared Notes read capability with delegated authority, records source URI/revision/body digest in
a proposal, and returns proposal URI. Acceptance later re-checks target/worktree and writes Memory;
it does not edit/delete/exclude the source Note.

- **CUR-KNOW-007:** Promotion is an idempotent saga by command ID. It MUST NOT copy a stale note
  silently; revision mismatch returns conflict. Repeating cannot create duplicate proposals.
- **CUR-KNOW-008:** Plugin events are facts only. Neither plugin subscribes to an event and mutates
  the other without a declared capability call and independent authorization.
- **CUR-KNOW-009:** These contracts define no stream. Snapshot and promotion bodies are bounded
  request/object data.

## 7. UI contributions and renderer requirements

Context exposes section/item/toolbar slots. Notes supplies section rows and navigation intent to its
pane; Memory supplies index rows plus proposal count/add/proposal-gate contribution. If Context is
absent, Notes pane and Memory attention/settings views remain available. If Notes/Memory is absent,
Context omits that section and reports optional plugin absence in contribution management, not as a
crash.

`notes.open` payload is `{taskUri,noteUri}`; `memory.open` is `{taskUri,entryOrProposalUri}`. The
shell validates ownership and renderer availability. No plugin calls another's component function.

## 8. Storage, migration, backup, uninstall and reinstall

Notes DB, Memory DB and client Context selection are separate. Cross-plugin fields are canonical
URIs plus revisions/digests; no foreign keys or attached databases. Backup captures each plugin
independently and records dependency versions. Restore can leave one disabled; references remain
inert until the same coordinate returns.

- **CUR-KNOW-010:** Removing Notes does not remove Memory proposals already created from Notes;
  their source becomes unavailable but provenance remains. Removing Memory never removes Notes.
- **CUR-KNOW-011:** Clean V2 imports none of the V1 Notes/data-root/Memory private/proposal/index
  state. Repository `.acorn/memory` is indexed as repository content after registration.

## 9. Setup, settings, health, update and failure

Each plugin owns setup/settings. Context discovers active section contracts after handshake.
Dependency update is resolved by SemVer/schema digest before activation. An incompatible optional
provider disables its section only. Timeouts preserve last authorized projection as explicitly stale.
Promotion failure leaves the source note and previous proposals unchanged.

## 10. Security and credential treatment

- **CUR-KNOW-012:** Section and promotion calls are resource-scoped; arbitrary URI, path, provider
  token and database access are prohibited.
- **CUR-KNOW-013:** Aggregate sensitivity is the strictest provider sensitivity. Note/Memory bodies
  never appear in events/logs; immutable agent snapshots are encrypted.
- **CUR-KNOW-014:** Markdown from either provider is sanitized by the renderer and has no command,
  navigation, network or native authority.
- **CUR-KNOW-015:** Agent Notes writes and Memory proposals carry unforgeable delegated provenance;
  Memory acceptance is a separate full-owner command with expected proposal revision.
- **CUR-KNOW-016:** A malicious optional provider cannot register another plugin's section ID,
  event namespace or navigation intent, exceed broker caps, or return a renderer it did not declare.

## 11. Coupling that must be removed

The following V1 edges MUST reach zero:

- Context → Memory `MemorySection`;
- Context → Notes `notesClient`;
- Memory `knowledgeIpc` → NotesStore;
- app context wiring → concrete Notes/Memory implementations;
- Notes → Context model;
- core schema ownership of Memory index and application route ownership of either plugin;
- shared `KnowledgeBridge`; and
- direct workflow/agent/headless notification calls.

They are replaced by the capability/event/slot/navigation contracts in this document.

## 12. Fresh-install parity scenarios

- **CUR-KNOW-017:** With default profile, Context displays the same Notes and Memory sections/order/
  defaults/budgets and exact compact output as V1-equivalent data.
- **CUR-KNOW-018:** Notes create/edit/include immediately invalidates only Notes; Memory accept/
  reconcile invalidates only Memory; prior agent sync becomes stale without duplicate delivery.
- **CUR-KNOW-019:** Notes → Memory promotion creates a human-gated proposal with immutable
  provenance and leaves the Note intact.
- **CUR-KNOW-020:** Disable/uninstall each plugin independently and verify remaining plugins start,
  show explicit degraded state, retain their data and never query the missing plugin's storage.
- **CUR-KNOW-021:** Remote Electron can edit Notes, gate Memory and assemble/send Context on the
  remote Node without acquiring files, DB handles or executable UI from it.
