# Phase 1: one edge model replaces two event paths

Shipped 2026-09-02. The vocabulary lives in [model.md](./model.md), which phases 2 to 6 still point
at. What the phase built, and where each part now lives:

- `packages/client-core/src/features/notifications/attention.ts` holds the five states, the two
  adapters, and `edgesBetween`. Pure, no Solid, no plugin import.
- `packages/client-core/src/features/notifications/deliver.ts` holds the gate: the one-second hold
  with its re-check, the seen rule, the sink list phases 3 to 5 fill, and `initWorkflowNotices`.
- `docs/frontend.md` § Shell state owns the five states and the seen rule.
  `docs/plugin-map.md` § Notifications owns which call a plugin makes.
- `notifyForEvent`, `detectEdges`, `trackSessionEdges`, `shouldToast`, and every `new Notification`
  call are gone, along with the PTY notice kinds `finished`, `needs-input`, and `exited`.

## Where the build departed from the requirements

**The snapshot map lives in the gate, not in each store** (requirements 3 and 5). Requirement 5 gave
the managed store its own `Map<sessionId, Snapshot>` and had it call `edgesBetween` and `deliver` in
turn. That map and the `latest` map requirement 3 gives the gate hold the same thing, and the second
one exists only so the hold can re-check. One map, in `deliver.ts`, behind `observeAttention(snapshots)`:
each adapter hands over what it has and the gate folds it in, raises the edges, and keeps the
result. It also clears itself on a node switch, so neither store has to remember to.

**`markAttentionSeen` takes an item id, not a session id** (requirements 10 and 11). The inbox holds
`AttentionItem` rows and never sees a session. Keying the seen set on the row's own id keeps the
plugin's id format out of client-core; the agents plugin builds that id in one place,
`agentAttentionItemId` in `plugins/agents/src/client/sessions/managedSelection.ts`, so the row and
the acknowledgement that retires it cannot drift apart.

**The acknowledgement also listens for window focus.** An effect over the session list alone misses
the commonest case: the session completed while the owner was elsewhere, and coming back changes
nothing the effect tracks.

**The terminal plugin gained a `terminal-session` notice target.** None existed. It opens the
drawer on the session's tab.
