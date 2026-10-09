# Dashboard followup work

Date: October 8, 2026. Status: proposed followups to the implemented panel studio and derived sources.

Use this page to pick up unfinished dashboard work. The twelve-phase programme shipped on
October 5, 2026; its completed plans and decisions remain in Git history.
[The panel editor](../dashboards/mapping-and-editor.md) and
[derived sources](../data-sources/derived-sources.md) own implemented behavior.

## Starting point

The launcher, full-window studio, outline, inspectors, undo, proposal review, quick panel edits,
input approval, derived-source helpers, and folder-plugin development loop are implemented.
The followups below can be assigned separately. Recheck each gap against the code before building.

Keep `PanelPlan` version 2 and published revision digests compatible. The Node executes plans;
the client displays results. Use host components for controls and keep plugin code in data-source
handlers. A studio opening from a task must preserve that task's panes and terminal drawer.

## Explain filters applied by a source

The inspector cannot identify which predicates a source applied from its query digest and parameters.
Add explicit diagnostics before displaying a claim about filter execution.

Start with `packages/node-core/src/server/dashboards/run.ts`,
`packages/client-core/src/features/dashboards/studio/inspectors.tsx`, and the contracts used by them.

Implement and verify these requirements:

1. Identify filters executed by the source and filters executed by the panel runner.
2. Return that distinction through the run diagnostics contract. Define how a client handles
   a Node that omits it.
3. Display the distinction in plain words near the relevant filter. Preserve saved source conditions.
4. Verify a source that accepts a filter, one that declines it, and a run whose source limit precedes
   filtering. The explanation must agree with the returned rows and completeness warnings.

The relations inspector did not receive the usability rewrite applied to the other inspectors.
Assess it separately with a real multi-source panel before proposing changes to its forms.

## Complete AI review interactions

The outline and column list offer **Ask AI about this**. A preview column header has no equivalent
menu, and the outline does not mark problems in the proposed plan during review.

Start with `packages/client-core/src/features/dashboards/studio/StudioPreview.tsx`,
`StudioOutline.tsx`, `studioStore.ts`, and
`packages/client-core/src/features/dashboards/views/PanelBody.tsx`.

Implement and verify these requirements:

1. Add a keyboard-accessible column action in applicable preview views. Pass its column identity
   through a typed view contract and reuse the outline's authoring focus behavior.
2. Map proposal problems to the proposed outline's parts. Keep them distinct from problems in the
   published plan, and clear them when the proposal is applied or set aside.
3. Verify focus return, a column removed by a proposal, a changed plan while a reply is pending,
   and narrow preview widths. Applying a proposal remains one undoable change.

Workflows uses the shared authoring conversation in a modal. Moving it to a dock needs its own
proposal comparison and layout design. Treat that as a separate Workflows task; preserve its
approval and publish rules.

## Resolve the GitHub branch-source exception

GitHub's local-branches source reads local worktrees through the compiled invocation API.
It has not moved to declared inputs. Start with `plugins/github/src/shared/branchSource.ts`,
`plugins/github/src/server/data/branchSourceHandler.ts`, and `plugins/github/src/node/index.ts`.

Stored panels put the account in `scope.connectionId` and the project in `scope.parameters`.
The source stamps `githubConnectionId` on records for its pull-request relation. Derived sources
refuse a top-level account and cannot also own a provider. Moving these fields changes saved queries
and their digests.

Choose and record one of these outcomes before implementation:

- Keep the source as a documented compiled exception and close the migration requirement.
- Migrate it to declared inputs. Design an account-bearing GitHub input, a bounded read-only account
  identity contract, and a migration for stored panels. Obtain a product decision on changed digests.

For a migration, verify saved panels from before the change, relations between branches and pull
requests, multiple GitHub accounts, input approval, and incomplete input reads. Preserve published
revisions or document and test the approved migration. Do not relax input authority to make the port fit.

## Verify and hand off

Use focused tests during implementation. Before handoff, run `pnpm lint`, package suites for changed
owners and consumers, and `pnpm --filter @acorn/arch-tests test`.
Update the owning reference docs with any changed contract.

Use the [isolated desktop driver](../local-development/agent-drivers.md) to inspect affected controls,
keyboard actions, proposal states, and narrow layouts. Record the model backend when testing a real
authoring turn. The terminal host displays a named placeholder for dashboard asides; this work does
not add a terminal panel editor.

## Verify before building

- Confirm that the gap still exists and locate the contract that carries its data.
- Check the diagnostic shapes and published plugin compatibility rules before adding fields.
- Recheck branch-source storage and account authority before designing a migration.
- Consult the removed programme in Git history for the decisions behind the implemented studio.
