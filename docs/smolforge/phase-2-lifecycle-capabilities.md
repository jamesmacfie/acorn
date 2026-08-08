# Phase 2 — Node-side lifecycle capabilities

**Size: M.** Provider-neutral. After this phase a node plugin can react to things happening on
the Node — an agent session finishing, a worktree being created, a commit or push completing —
and can schedule background revalidation. Today none of that is possible: `ctx.events` is
client-invalidation only ("nothing in the node listens" — `PluginBroadcast` in
`packages/node-core/src/server/plugin/types.ts` documents this deliberately), and there is no
node-side subscription mechanism at all.

This is the third time this gap has surfaced (herdr-style notifier analysis, mobile push in
docs/future/remote.md, now SmolForge transcript upload) — which is the evidence it should exist.

## Design principle: capabilities, not an event bus

`docs/plugins.md` names exactly four collaboration mechanisms and pointedly rejects a general
event bus; `types.ts` records that history ("Rather than build the bus the docs described, this
blesses what is real"). Respect that: lifecycle notifications are **typed capabilities published
by the owning plugin/core**, resolved late, one per concern — not a string-keyed bus. Costs of a
bus (unknowable audience, payload drift, ordering ambiguity) stay avoided; each capability has
one owner, one payload type, one documented delivery contract.

Delivery contract, identical for all of them and stated on each capability's type: **at-least-
once within a running Node process, no persistence, no replay across restarts, fire-and-forget**
(subscriber errors are caught and logged by the publisher, never propagate). A subscriber that
needs durability records its own high-water mark and reconciles on `init` — see "Reconcile
pattern" below. This mirrors the client invalidation channel's honesty: it is a nudge, not a log.

All payloads must be structured-clone-safe and the subscribe signatures async-friendly
(docs/third-party/node-security.md design rules 3/5 — these capabilities must survive a future
process boundary where "subscribe" becomes an RPC-stream).

## The capabilities

Each is published by its owner during `init`/`ready`; consumers resolve at call time and treat
absence as "feature degraded" (standard capability semantics).

### From core (task/worktree/git lifecycle)

Published by core into the capability registry the host owns
(`packages/node-core/src/server/plugin/capabilities.ts`); implementation hooks live where the
operations already complete:

```ts
CORE_ON_TASK_CREATED       // { taskId, projectId, origin, workspaceId }
CORE_ON_WORKTREE_CREATED   // { taskId, projectId, path, branch }
CORE_ON_COMMIT_CREATED     // { projectId, taskId?, worktreePath, sha, branch }
CORE_ON_PUSH_COMPLETED     // { projectId, taskId?, remoteUrl, branch, shas: string[] }
```

Implementation notes:

- Task/worktree emission points are the completion of the existing creation flows
  (`packages/node-core/src/main/core/tasks/service.ts` and the worktree path it wraps —
  remember the ordering: worktree first, then the task).
- Commit/push observation is the subtle one. Acorn-initiated git operations (core/vcs) emit
  directly at their completion sites. Commits made by agents or by the user **in a terminal**
  do not pass through core — do not try to intercept them. Instead emit from a cheap poll of
  ref state per active worktree (mtime of `.git` refs, or `git rev-parse` on access patterns
  that already exist), and document the payload as "observed", not "caused": consumers get the
  sha and must treat it as possibly-late notification, never as the only copy of the fact.
  This keeps the capability honest and cheap; a consumer needing exactness reconciles from git
  itself (it has the worktree path).

### From the agents plugin

```ts
AGENTS_ON_SESSION_STATUS   // { sessionId, taskId, agentKind, status: 'idle'|'working'|'blocked'|'done', at }
```

Published by `plugins/agents` (contract file beside
`plugins/agents/src/contract/sessionExecute.ts`, following its `capabilityId<T>` pattern). The
agents plugin already persists a durable per-session event sequence; this capability is a
projection of transitions it already knows. `done`/`blocked` are the transitions integrators
care about (upload transcript / notify owner).

### Scheduled revalidation

Not an event — a scheduler, for providers that cannot receive webhooks (the Node is loopback;
SmolForge has webhooks but nothing routable to deliver them to):

```ts
// On NodePluginContext (new member, host-implemented):
schedule: {
  every(intervalMs: number, id: string, run: () => Promise<void>): void  // disposed with the plugin
}
```

Host-side: one timer wheel, per-plugin registration recorded for disposal like every other
registration, minimum interval enforced (suggest 60s), overlapping runs skipped (a run still in
flight when the next tick fires is not re-entered), errors logged with the plugin prefix. This
is deliberately minimal — no cron syntax, no persistence, no catch-up after sleep; it is
"revalidate my mirror sometimes", not a job system.

## Reconcile pattern (document it with the capabilities)

Because delivery is process-lifetime only, every consumer pairs a subscription with a reconcile
pass in its own `ready()`: e.g. the SmolForge plugin records the last-uploaded session id per
task in its own table, and on boot lists completed sessions newer than the mark (via the
phase-3 export capability) before subscribing. Write this pattern into the plugin-api docs for
these capabilities — subscribers who skip it will silently miss everything that happened while
the Node was restarting, and the bug reports will land on core.

## Steps

1. Delivery/error/dispose semantics as a small shared helper (publisher-side subscriber list +
   catch/log + disposal registration), so the four core capabilities and the agents one don't
   hand-roll five copies.
2. Core capabilities + emission points; agents status capability in the agents contract.
3. `ctx.schedule` in the node plugin host with disposal and overlap-skip.
4. Plugin-api exports for the capability ids and payload types (they are public surface —
   d.ts snapshot updates deliberately).
5. Tests: emission on the real flows (task/worktree creation integration tests exist to extend);
   subscriber error containment (a throwing subscriber never fails the operation that emitted);
   disposal on plugin disable; schedule overlap-skip and minimum-interval clamp; observed-commit
   poll emits on an out-of-band commit in a temp worktree.

## Exit criteria

- A test plugin receives task-created, worktree-created, and agent-done notifications; its
  throwing subscriber affects nothing; disabling it detaches everything.
- Out-of-band commit in a worktree produces an observed-commit notification within one poll
  interval.
- `ctx.schedule.every` runs, skips overlaps, and dies with the plugin.
- Capability ids/payloads exported from plugin-api; snapshot updated once, deliberately.
- `pnpm lint`, suites, boundaries test green.
