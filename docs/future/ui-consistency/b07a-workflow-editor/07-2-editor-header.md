# 07-2. The workflow editor's header is a 26-pixel row with no bar

**Status:** done 2026-10-02 on `more-ui`. Batch B07a. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

The editor's header is `Toolbar variant="actions" size="sm"`, the form-footer variant: no fill, no
divider, no minimum height. Beside the list's 48-high header it is a 26-high row, then the tab strip
starts at a third height, so three horizontal lines in the top 114 pixels fail to line up. The
workflow's name is 12px strong text where the house pattern is a level 2 heading. **← Workflows**
goes back to the list that is already on screen beside it. The editor is the heart of the area, and
its top edge looks unfinished.

## Where to see it

Workflows in the left rail, then **Release check** (or any definition). For **← Parent workflow**, open
a child workflow from a step that runs one.

## The fix

In `plugins/workflows/src/client/editor/WorkflowEditor.tsx`:

- Around `:306`: `<Toolbar variant="actions" size="sm">` becomes `<Toolbar>`, the 48 bar.
- Around `:307`: remove **← Workflows**.
- Around `:308-314`: **← Parent workflow** becomes a ghost xs button with the `arrow-left` icon, before
  the heading. A link eyebrow would need a new `Heading` prop, which this pass does not add.
- Around `:315`: `Text emphasis="strong"` becomes `Heading level={2}`. Then the status badges
  ([07-19](./07-19-save-and-publish-marks.md)), a `ToolbarSpacer`, and the controls at sm.

What the bar drops at narrow widths is a product call, deferred (see [deferred.md](../deferred.md)).

## Copy

The header, alert, and toast rows from `WorkflowEditor.tsx`. The save and publish badges are 07-19's;
the footer is [07-10](./07-10-problems-footer.md)'s; the overflow menu's delete is
[07-16](./07-16-menus.md)'s. The dialog rows (Publish, Export, AI authoring) are B07b's
[07-18](../b07b-workflow-runs/07-18-dialogs.md).

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `:307` | ← Workflows | Remove | The list is beside it. |
| `:313` | ← Parent workflow | Keep | As a ghost xs button with `arrow-left`. |
| `:333` | Copy to database | Rewrite | Make an editable copy |
| `:343` | Publish this workflow before running it. | Keep | |
| `:420` | Run unavailable | Rewrite | Can't run this workflow |
| `:437` | A review is waiting | Rewrite | Publishing isn't finished |
| `:439` | This workflow has a publication that was not finished. / An export to the repository was not finished. | Rewrite | Review it to finish or discard it. / Review the export to finish or discard it. |
| `:501` | This one is a committed file. Copy it to the database to change it. | Rewrite | This workflow is a file in the repository. To change it here, make an editable copy. |
| `:503` | This address does not name a workflow. Go back and pick one from the list. | Rewrite | This workflow doesn't exist. Choose one from the list. |
| `:113` | Choose a workspace before creating a child workflow. | Keep | |
| `:138` | The child workflow could not be created. | Rewrite | Couldn't create the child workflow. |
| `:172` | Workflow saved. | Keep | |
| `:197` | The draft changed while AI was working. Review these conflicts first: {paths} | Rewrite | You changed the workflow while AI was working. Sort out these steps first: {step names} |
| `:200` | The reconciled proposal is no longer valid: {problems} | Rewrite | AI's changes no longer fit your workflow: {problems} |
| `:203` | AI proposal applied. Undo restores the previous draft. | Rewrite | AI's changes applied. Undo puts your version back. |
| `:213` | Copied. This one is yours to edit. | Keep | |
| `:219` | Workflow deleted. | Keep | |
| `:281` | Published revision {n}. / Published. | Rewrite | Published. |
| `:287` | Exported. The files are not committed yet. | Rewrite | Exported. The files aren't committed. |
| `:426-427` | Your change: {json} / Changed elsewhere: {json} | Keep labels, rewrite values | Show the value as text, not JSON. |
| `:429-430` | Keep your change / Keep external change | Rewrite | Keep mine / Keep theirs |

"Make an editable copy" is also part of [07-20](../b07b-workflow-runs/07-20-one-word-per-idea.md).
Do it here and skip it there.

## Already done

- K1a forces sm on buttons in a bar `Toolbar`, so controls in the new bar size themselves.

## Risk and checks

- Before you start, read the header block. Count the controls; at 1440 wide they fit, but at narrow
  widths they will not.
- A dismissed Publish review leaves a prepared publication that breaks the workflow after a node
  restart ("requires reconciliation"). If you hit it, discard the publication through
  `/defs/publications/:id/discard`. See [the README](../README.md#hazards-in-the-running-app).
- Screens: the editor on a new workflow and on **Release check**, side by side with the list header.
- Tests: `plugins/workflows` (`WorkflowEditor.test.tsx`).
