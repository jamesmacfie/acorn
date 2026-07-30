# Unified Fleet experience

Status: Normative<br>
Requirement prefix: `UX-FLEET`

The Fleet is an Electron presentation over independent Nodes. It unifies navigation and awareness,
not databases, authority or transactions.

## Fleet home and rail

- **UX-FLEET-001:** Fleet home summarizes each paired Node's connection, health, active work,
  attention and last refresh; it remains available with zero online Nodes.
- **UX-FLEET-002:** Rail shows Fleet sources first, then Node/workspace hierarchy and selected
  workspace sources/tasks. The active Node is always visible in topbar/crumbs for a remote resource.
- **UX-FLEET-003:** Workspace picker groups by Node and supports search over Node/workspace/
  repository labels. Results include Node badge/fingerprint fragment where labels collide.
- **UX-FLEET-004:** Switching workspaces atomically switches Node connection context and restores
  that workspace's last source/task/layout without sending a product mutation.

## Aggregated surfaces

| Surface | Aggregation | Mutation |
| --- | --- | --- |
| Agent Center | bounded sessions/status per online Node | targets one session's Node |
| Attention | authorized snapshot/events per Node | resolve on subject Node |
| Notifications | client notice projection labeled by Node | action reauthorizes on Node |
| Activity | bounded event projections with per-Node cursor | navigation or one-Node command |
| Search | fan-out authorized bounded queries | result opens owning Node resource |

- **UX-FLEET-005:** Electron issues parallel per-Node reads with per-Node deadline, rate and
  cancellation; slow/offline Nodes produce partial results and visible source status, not failure of
  healthy Nodes.
- **UX-FLEET-006:** Sort and grouping use received authorized fields. Every row retains Node ID,
  freshness and canonical resource; display labels never merge identities.
- **UX-FLEET-007:** Federated search declares selected Nodes, resource types, query syntax, result/
  Node cap and timeout. Default maximum is 100 results per Node and 2,000 total.
- **UX-FLEET-008:** A mutation launched from an aggregate surface shows target Node/resource and
  submits one command. “Apply to all Nodes” exists only as an explicit client-orchestrated batch of
  individually authorized idempotent commands with per-Node outcomes and no atomicity claim.

## Tasks and workspaces

- **UX-FLEET-009:** Task rows remain scoped to active workspace and preserve pin/drag order,
  decorations, keyboard task selection and archive/rename behavior.
- **UX-FLEET-010:** A task never spans Nodes. Links may point to resources owned by plugins on the
  same Node; a cross-Node reference is a non-transactional external link that opens the other Node.
- **UX-FLEET-011:** Creating/promoting a task selects one Node/workspace/repository, shows that
  target throughout the form, and derives branch/worktree only on that Node.
- **UX-FLEET-012:** Duplicate repository remotes/branches on different Nodes are separate resources
  and may appear with disambiguating Node labels.

## Connection and consistency

- **UX-FLEET-013:** Connection state is per Node. Global offline banner is reserved for zero usable
  Nodes; otherwise each affected source/row carries its own state.
- **UX-FLEET-014:** Event cursors, resource revisions and cache invalidation are per Node.
  Resynchronizing one Node cannot reset healthy Node views.
- **UX-FLEET-015:** Relative time uses Electron clock but shows Node clock-skew warning when
  ordering could be misleading. Cross-Node event ordering is approximate and never presented as a
  causal total order.

## Privacy and performance

- **UX-FLEET-016:** Owner can exclude Nodes from aggregate notifications/search/activity on this
  client as presentation policy; this does not revoke Node authority.
- **UX-FLEET-017:** Aggregate caches retain the source Node's sensitivity/expiry. Removing a Node or
  owner profile purges its Fleet projections.
- **UX-FLEET-018:** Electron limits concurrent Node work, cancels superseded queries and renders
  progressive results without allowing one Node/plugin payload to block the UI thread.

## Acceptance

- **UX-FLEET-019:** Tests use at least three Nodes with colliding labels/resource IDs, mixed
  versions, one offline, one slow, one expired event cursor and concurrent task activity; verify
  correct labels, partial results, single-Node mutations, independent restore and cache purge.
