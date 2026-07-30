# Consistency, transactions and sagas

Status: **Normative**
Requirement prefix: `DATA-CONS`

## Consistency model

- **DATA-CONS-001** Within `core.sqlite`, a committed command and its core events are strongly
  consistent and observed at one revision/sequence boundary.
- **DATA-CONS-002** Within one plugin database, domain changes and plugin-local events are strongly
  consistent. Projection into global events is eventually consistent and idempotent.
- **DATA-CONS-003** Between core and plugins, between plugins, and between Nodes, no transaction is
  shared. A documented saga, compensation and visible intermediate state are mandatory.
- **DATA-CONS-004** Provider mirrors are eventually consistent caches and MUST expose source
  freshness. Provider mutation success is not inferred from mirror state.

## Transaction discipline

Transactions MUST be short, synchronous with respect to database calls, and contain no network,
filesystem, process, UI or cross-plugin invocation. Handlers use:

1. validate request and resolve authorization;
2. read expected revisions;
3. perform external/preparatory work if safe;
4. open transaction, recheck revision, write state plus outbox, commit;
5. perform post-commit effects using a durable operation; and
6. return committed identity/revision/sequence.

- **DATA-CONS-005** Locks are acquired in canonical URI byte order. Busy exhaustion after five
  seconds returns retryable `temporarily_unavailable`; it never bypasses revision checks.
- **DATA-CONS-006** Database errors map to stable errors. Unique/check/foreign-key failures expected
  from races are domain conflicts; corruption is fail-closed.

## Saga state

An operation records:

- operation/command/target IDs and expected revision;
- state `planned|running|waiting|compensating|committed|cancelled|failed|manual_intervention`;
- ordered step ID, adapter idempotency key, attempts, deadline and result digest;
- explicit commit point;
- reverse compensation order and outcomes; and
- safe owner-visible recovery instruction.

Each step transition is persisted before/after its external effect. Adapters MUST accept a stable
idempotency key or implement read-before-retry reconciliation.

## Required sagas

| Flow | Commit point | Compensation |
| --- | --- | --- |
| Plugin install/update | candidate lock activated after migrations and health | restore DB/artifact if reversible |
| Worktree create | Task revision moves to `ready` | remove contained worktree or mark manual |
| Workspace transfer | destination owner explicitly commits | source remains authoritative before commit |
| Brokered provider mutation | provider confirms stable result | operation-specific inverse or manual |
| Cross-plugin workflow | workflow state commits outcome | declared compensation capabilities |
| Backup | encrypted archive verified/renamed | delete incomplete temp archive |

- **DATA-CONS-007** Compensation is a new fact, not history deletion. It emits events and retains the
  failed operation.
- **DATA-CONS-008** Cancellation is honored only before the declared commit point. After it,
  cancellation returns `already_committed`; a separate undo command may exist.
- **DATA-CONS-009** Restart reconciliation scans all nonterminal operations before accepting commands
  that target the same resources.
