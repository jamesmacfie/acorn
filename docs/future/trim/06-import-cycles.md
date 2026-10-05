# Phase 06: remove the identified internal value-import cycles

Completion note, October 6, 2026: removed the six-module workflow and three-module agents
value-import SCCs. `definitions/builtinDefinitions.ts` owns pure built-in kinds, policies, and
validators; `definitions/fingerprint.ts` owns the unchanged persisted hash; and client
`paneIdentity.ts` owns `AGENT_PANE_ID`. Runtime handlers and mutable selection remain with their
existing owners. Compatibility exports remain in `steps/builtins.ts`, `definitions/resolution.ts`,
and `paneContribution.ts`. The retained [graph](./artifacts/phase-06-import-graph.json) has no
SCC in either area. The existing architecture scanner does not analyze internal TS value-import
cycles, so this phase retains reproducible graph evidence rather than adding a file-text rule.
Phase 07 can treat these owners as stable and need not change workflow identity or agent selection.

Date: 2026-10-06. Status: DONE. Risk: low to medium; identity and fingerprints must remain stable.
Prerequisite: accepted [phase 05](./05-keymap.md). Next: [phase 07](./07-tab-rail.md).
Planning revision: `2ae55abb5`; resolve moved paths through earlier handoffs.

## Task and context

Remove the two identified internal cycles by giving constants and pure definition logic neutral
owners. Package boundaries already reject package-level cycles, but the audit's TS value-import
graph found cycles inside workflows and agents. Do not turn value imports into misleading type
imports or defer them dynamically to hide the dependency.

## Starting points and current graph

Workflow owners are under `plugins/workflows/src/server/`:

- `definitions/files.ts` imports built-in kinds, policies, and validators from `steps/builtins.ts`.
- `steps/builtins.ts` imports `processing/incremental.ts` for execution.
- Incremental processing imports `definitions/resolution.ts`, which imports file loading.
- `processing/store.ts` and `processing/reprocess.ts` also import the fingerprint from resolution.
- `workflowContentFingerprint` hashes recursively normalized JSON: sorted object keys, omitted
  undefined object values, ordered arrays. Persisted processing identity depends on its exact output.

The agent cycle is in `plugins/agents/src/client/`: `sessions/managedSelection.ts` imports
`AGENT_PANE_ID` from `paneContribution.ts`; that imports `sessions/agentPaneModel.ts`, which imports
selection. Selection is app-lifetime state, including the recently added per-session Chats only filter.

Read [workflows](../../workflows.md), [managed agents](../../managed-agents.md), and
[conventions](../../conventions.md). No route, schema, wire type, or persisted ID changes belong here.

## Implementation steps

1. Re-run phase 01's value-import graph. Confirm the live strongly connected components and identify
   direct consumers/re-exports of the built-in tables, fingerprint function, and pane ID.
2. Extract built-in kinds, policies, and definition validators into a feature-owned definition module
   with only pure dependencies. Keep execution handlers in `steps/builtins.ts`. The `decide` validator
   uses `stepIdentity`; find its owner and preserve its graph-aware `precedes` validation. Reuse an
   existing pure identity module rather than importing runtime handlers back into the new owner.
3. Extract the content fingerprint into a pure definition helper, with Node crypto remaining in the
   server. Route file resolution and processing consumers to it. Preserve normalization, locale key
   sorting, hash algorithm, defaults, and bytes exactly; no fingerprint version change or migration.
4. Extract `AGENT_PANE_ID` into a neutral client identity module. Selection and pane registration read
   the same constant. Preserve any public/re-exported access needed by current consumers without
   making selection depend on registration. Do not relocate or duplicate selection signals.
5. Update imports and mocks that only existed to avoid executing the cyclic pane registration module.
   Keep focus consumption, selected sessions/subagents, request focus, and Chats only behavior intact.
6. Re-run the graph and retain edge/SCC evidence. Add a narrow architecture regression for these
   ownership seams if the existing scanner can enforce it without a new broad framework. Otherwise
   retain the reproducible graph check and behavioral proof; do not add tests of file text or size.

## Verification

```sh
pnpm test:focus @acorn/plugin-workflows src/server/definitions/resolution.test.ts
pnpm test:focus @acorn/plugin-workflows src/server/definitions/catalog.test.ts
pnpm test:focus @acorn/plugin-workflows src/server/processing/store.test.ts
pnpm test:focus @acorn/plugin-agents src/client/sessions/managedSelection.test.ts
pnpm test:focus @acorn/plugin-agents src/client/sessions/agentPaneModel.test.tsx
pnpm lint
pnpm test --filter=@acorn/plugin-workflows --filter=@acorn/plugin-agents --filter=@acorn/node --filter=@acorn/tui --filter=@acorn/desktop
pnpm --filter @acorn/arch-tests test
```

Use existing resolution/processing fixtures to compare known fingerprints before and after; add a
case only if key ordering, undefined fields, or array order lacks proof. Execute validators through
file/catalog behavior. Check pane activation and Chats only after navigating away and back.

## Acceptance and handoff

- Both identified SCCs are absent from the same graph method, with no hidden dynamic-import escape.
- Definition validation and fingerprint identity are unchanged; existing data still resolves.
- Pane ID, focus, selection custody, and per-session Chats only behavior remain unchanged.
- Public consumers, package suites, and architecture checks pass. No duplicate tables or constants.
- Record new owners and graph results in task/table/evidence for phase 07. Rollback restores the
  extraction/import changes together; never rewrite fingerprints to compensate for a mistake.

## Verify before building

Inspect current SCCs, identity helpers, exports, and the latest selection change. Stop on a proposed
fingerprint semantic change or public identity change; this phase only changes ownership.
