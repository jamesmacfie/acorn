# Phase 6: docked AI and reviewing proposals

Status: proposed, October 5, 2026. Depends on [phase 2](./02-plan-outline-model.md) and
[phase 3](./03-studio-shell.md). Read the [programme README](./README.md) first. The
[Panel Editor Review](https://claude.ai/artifact/EA1H3DdvVEUd9WTNg5MWyf) shows a proposal under
review in "AI creation and AI edits".

## Goal

Make the AI a collaborator docked beside the plan, the way the agent conversation sits beside a
task. A proposal is a pending change to the plan you're looking at. You review it on the outline,
which marks what it adds, changes, and removes, and on the preview, which switches between before
and after. Then you apply it as one undoable step. You can also aim the AI at one part of the
panel.

## Starting point

- `AuthoringConversation` (`packages/client-core/src/features/dataSources/AuthoringConversation.tsx`)
  draws in one of two ways. With `onClose`, it draws as a modal body and footer, which Workflows
  uses. Without it, it draws as a `Fold`, which the old dashboard editor and `SourceQueryEditor`
  use. After phase 3, the studio opens it in a modal.
- It's part of the published plugin API through `@acorn/plugin-api/ui/data-sources`, and
  `plugins/workflows/src/client/editor/WorkflowEditor.tsx` imports it from there. A props change is
  a published surface change. `tools/arch/publishedPluginSurface.snapshot.txt` records that
  surface.
- Each turn goes to `POST /v1/core/authoring/turn` (`packages/node-core/src/server/routes/authoring.ts`).
  A reply is a `clarification` with choice buttons, a `proposal`, `unavailable`, or `stopped`
  (`AuthoringTurnResult` in `packages/protocol/src/data/authoring.ts`).
- A proposal carries `base`, `candidate`, `summary`, `diff`, `problems`, and `unaddressed`. The
  `diff` comes from `semanticAuthoringDiff`, which can't tell one stage from another because
  stages have no ids. Phase 2's `diffOutline` can.
- The conversation shows a proposal as up to 20 lines such as
  `Changed /columns/3/label: "Status" → "State"`, with JSON cut at 500 characters, and token counts.
- The conversation keeps its context in `localStorage` under
  `acorn:ai-authoring:v1:<cacheId>:<target>:<targetId>`. For a new panel, `targetId` starts as
  `new:<workspaceId>` and becomes the draft id after the first save, so the stored conversation is
  orphaned at that moment.
- The dashboard proposal carries `requirements` in the plan. Phase 3 kept the rule that every
  requirement must be ticked before publishing.
- The model and backend choice is a saved preference (`readGeneratePick` and `saveGeneratePick`).

## Requirements

### A docked conversation

1. Add a third way for `AuthoringConversation` to draw: `layout?: 'fold' | 'modal' | 'dock'`. Keep
   `onClose` meaning modal when `layout` is unset, so Workflows and `SourceQueryEditor` don't
   change. Update the published surface snapshot in the same change and say why in the commit.
2. In `dock` layout the conversation fills its container:
   - A header with the model and backend as one compact `Select`, and a settings `Menu` holding
     **Use preview records to help AI** and its explanation.
   - The turns so far, read from the context entries: the person's messages, the AI's summaries,
     clarifying questions with their choice buttons, and proposals.
   - A `Composer` at the bottom with the placeholder "Ask for a change".
   - Token usage behind a **Details** toggle on each proposal, not on every turn.
3. In the studio, **Ask AI** toggles the dock. It replaces the inspector column while open, and
   **Close** brings the inspector back. The dock's open state is per studio session.
4. Fix the orphaned conversation. When a new panel's draft gets its id, move the stored context
   from the `new:<workspaceId>` key to the draft id's key. Do it in the studio store, where the id
   arrives, through a small exported helper on the conversation module.

### Reviewing a proposal

5. When a proposal arrives, the studio enters review. The store holds `pending: { proposal, merged }`,
   where `merged` comes from `mergeAuthoringCandidate(base, candidate, current)` as today. A merge
   conflict ends review with the existing message: "This panel changed while the proposal was
   prepared."
6. During review:
   - The outline draws `diffOutline(current, merged)`. Added rows have an add mark, changed rows a
     change mark, and removed rows show struck through in their old position. The columns row's
     detail shows `columnChanges`, such as "+ Approval, − Draft".
   - The preview gains a **Before** and **After** `SegmentedControl`, set to **After**. **After** runs
     `merged` as a draft preview. **Before** shows the current plan's run, which is already cached.
     The row count reads "17 rows (was 41)".
   - The inspector is read-only for the selected part and says "Apply or discard the proposal to
     keep editing."
   - The toolbar shows a **Reviewing AI proposal** badge, and **Publish…** is disabled.
   - The status bar summarizes the diff: "Proposal: 1 column changed, 1 step added, grouping
     added".
7. The proposal in the dock shows, in order:
   - The summary.
   - The requirements, one line each, with a mark for covered, partly covered, needs a choice, or
     unavailable, and the reason for the last three. Each item with `paths` links to the outline:
     `partForPath` picks the part, and clicking selects it.
   - `unaddressed` items as "Not covered: *text*".
   - Problems, if any, which disable **Apply**.
   - **Apply** and **Discard**. The composer below stays live for "Ask for changes".
8. **Apply** validates through `client.validate`, as `applyAiProposal` does, then applies `merged`
   through the store as one undo step and leaves review. **Discard** calls the conversation's
   reject path and leaves review. Sending a new message while reviewing discards the pending
   proposal first.

### Requirements stop being a gate

9. Remove the rule that every requirement must be ticked before publishing, and the checkboxes.
   Applying a proposal accepts it.
10. The **Publish…** review lists requirements marked partly covered, needs a choice, or
    unavailable, and any `unaddressed` items from the last applied proposal, as warnings. They don't
    block publishing.
11. The status bar shows "*N* requirements not fully covered" while any exist, as a `Link` that
    opens the dock on the last proposal.

### Aiming the AI

12. **Ask AI about this** on an outline row's menu, or on a column header's context menu in the
    preview, opens the dock and prefills the composer with "About *part title*: ". On send, the
    instruction carries the part's JSON pointers in a fixed prefix the model can read:
    `[Focus: /stages/1 "Keep where Author is you"] `. This needs no protocol change.
13. Add one line to the dashboard target's system prompt in `authoring.ts`: an instruction that
    starts with a focus prefix is about those paths, and the model changes other parts only when
    the request needs it.

### Creating with AI

14. When the launcher returns `{ kind: 'describe', request }` (phase 5), the studio opens with an
    empty outline, the dock open, and the first turn sent with the request. A clarifying question,
    such as which GitHub account, shows its choices as buttons in the dock. The first proposal
    fills the outline in review, so the person sees the whole plan marked as added.
15. **Edit with AI…** from the panel menu (phase 7) opens the studio with the dock open and the
    composer focused.

### Workflows

16. Leave Workflows on the modal in this phase. Note in the doc update that the dock is ready for it.
    Moving Workflows needs its own outline diff, which is a separate change.

## Out of scope

- A protocol field for focus. The text prefix in requirement 12 is enough until evaluation shows
  it isn't.
- Persisting dismissed requirement warnings.
- Streaming partial replies.

## Tests

- `AuthoringConversation.test.tsx`: `dock` layout renders the turns and composer; the existing
  `fold` and modal tests still pass unchanged.
- `studioStore.test.ts`: entering review, applying as one undo step, discarding, a merge conflict,
  and the context key move in requirement 4.
- `PanelStudio.test.tsx`: during review the outline marks an added step, the inspector is
  read-only, and **Publish…** is disabled.
- `packages/node-core/src/server/routes/authoring.test.ts` or the evaluation suite in
  `packages/dashboards-core/src/authoringEvaluation.test.ts`: a scripted turn with a focus prefix
  changes only the focused stage.

## Check it in the app

You need a model backend configured. In a `dev:agent` session, open **Add panel**, type "Tasks
updated in the last 7 days, newest first", and check that the outline fills with added marks, the
preview's **Before** is empty, and **Apply** leaves an undoable plan. Then use **Ask AI about this**
on the filter step and ask for 14 days.

## Docs to update

- `docs/dashboards/mapping-and-editor.md` § The generated editor: the dock, review, and the end of
  the requirements gate.
- `docs/api-reference/core-routes.md`, where `/v1/core/authoring/turn` is documented: the focus
  prefix.
- `docs/workflows.md`: one line that the docked layout exists.

## Verify before building

- The published surface snapshot in `tools/arch/publishedPluginSurface.snapshot.txt` and which
  `AuthoringConversationProps` fields it records.
- How `AuthoringConversation` reads its context entries, so the dock can draw past turns from them
  without a second store.
