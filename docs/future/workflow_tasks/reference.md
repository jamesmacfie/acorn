# Execution contract

Date: 2026-09-12. Status: implementation proposal, not started.
Baseline: `8cb7ce45`. Paths describe the surveyed code, not a promise that it has stayed unchanged.

This is the normative design for this programme. Concrete persisted names may follow repository
conventions, but changes to the semantics require an explicit design amendment.

## Definition shape

Add step kinds `workflow` and `workflow-map`. Both use a distinct `childWorkflow` configuration
with a scoped definition reference and input bindings. Use `child_workflow` in TOML.
Do not reuse the TOML `workflow` key, which means static inline expansion.

A reference is a discriminated value: database definition ID, repository-relative definition,
or user-layer definition. Resolve it in the parent's workspace and project. No filesystem escape,
cross-Node lookup, dynamic model-selected reference, or arbitrary inline child definition.

Bindings are a closed tagged union: literal string, parent input name, or structured predecessor
output plus JSON Pointer. Map steps also permit an item JSON Pointer. String workflow inputs
remain strings: reject objects, missing values, and implicit coercion. Check source steps are
transitive predecessors. Parse pointers without evaluation or prototype traversal.

A map has a structured predecessor output and JSON Pointer selecting an array, an item-key
pointer selecting a nonempty string, child-input bindings, and a title template. Title templates
use the same closed binding vocabulary, never shell interpolation. Core derives a safe unique
branch from title plus intended task identity; users and models do not supply shell fragments.

Example conceptual configuration, not accepted syntax before phase 1:

```json
{
  "kind": "workflow-map",
  "childWorkflow": {
    "ref": { "source": "database", "id": "REVIEW_WORKFLOW_ID" },
    "inputs": { "ticket": { "from": "item", "pointer": "/number" } }
  },
  "items": { "step": "select-tickets", "pointer": "/tickets" },
  "itemKey": "/id"
}
```

## Preflight and snapshots

Resolve the entire referenced definition graph before dispatch. Reject cycles, out-of-scope
references, undeclared inputs, missing required bindings, invalid defaults, and unsupported kinds.
Freeze definitions and resolved defaults for the run tree. Store source provenance and a content
fingerprint. Check repository trust for every file source, not just the root. Recheck effective
authorization at dispatch; a snapshot cannot preserve revoked authority.

Drafts may remain invalid. Starting a run may not. Runtime item values are validated before
creating any task for that map. A definition edit cannot change an already-started tree.

## Durable identity and lifecycle

Each invocation has a unique caller key, payload fingerprint, reserved task ID, reserved run ID,
root run ID, parent run ID, parent step ID, optional item key, and timestamps.
Persist states equivalent to reserved, task-created, run-started, and terminal, plus recoverable error.
Uniqueness is enforced in storage. Same key and payload returns the recorded result; conflicting
payload fails. Reserve identity before effects. Do not derive identity from an array index alone.

Run lineage is explicit. Root depth is zero. Initial maximum child depth is one and maximum
descendant tasks per root is 12, across all dispatch steps. These are conservative release limits,
not fundamental restrictions in the lineage schema. Reject deeper graphs before starting.

A dispatch step waits durably for its children without occupying an agent execution slot.
Map results preserve source order and contain item key, task ID, run ID, terminal status, and a
bounded result summary. Empty arrays succeed. Any failed or safety-railed child fails the dispatch
after all admitted children settle. No detached mode. Downstream graph readiness follows the
ordinary done/failed rules.

Cancellation stops admission, cancels descendant runs and their managed sessions, and settles the
parent only after descendants settle. Cancellation and terminal transitions are idempotent.
A gate in a child requires attention and keeps the parent waiting; it does not auto-approve.
Retries resume the same invocation roster. They never create replacement tasks implicitly.
A deliberate fresh root run creates fresh invocations.

## Limits and authority

Intersect child settings with the root's approved execution ceiling and dispatch-step ceiling.
A read-only query step does not make its sibling dispatch read-only; the enclosing approved
workflow must authorize the dispatch. Neither child definitions nor prompts can broaden grants.
Task tokens remain scoped to their own tasks.

Use one root accounting owner for all descendant work. Count each usage record once. Reserve
admission and turn allowances atomically, share the agent semaphore, and propagate the ancestor's
absolute deadline. Declared child budgets may narrow the remaining allowance. Report measured
provider cost honestly: cancellation after usage arrives is not a hard pre-spend dollar guarantee.
Retain incurred usage across retries.

## Deduplication boundary

This programme prevents duplicate dispatch on retries and recovery within one root run.
It does not suppress the same business item across independent root runs. An hourly query for
tickets updated in 24 hours can process the same ticket repeatedly. Cross-occurrence processing
policy belongs to the later query design; do not silently invent an exactly-once business rule.

## Verify before building

- Confirm input, trust, and budget contracts against the owning docs and baseline code.
- Confirm the static TOML expansion key before adding the runtime reference.
- Prove every identity and terminal-state invariant with persistent-database tests.
