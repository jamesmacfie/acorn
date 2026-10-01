# 07-6. The inspector has no header, and its small fields stretch across the column

**Status:** not started. Batch B07a. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

The editor's inspector looks like neither a settings page nor a detail pane. Beside the outline's
48-high header it has no bar: a step starts with a level 3 heading and a kind badge, and
**Definition** and **Inputs** start with a bare field. The run pane's step detail, the same idea one
screen away, has a proper header. Every input and select is sm (26) in a page body, under md prompt
boxes, and everything fills about 760 pixels, including number boxes for a single digit. A form that
fills a wide column is hard to scan.

## Where to see it

Workflows › any definition › **Outline** tab. Select **Definition**, **Inputs**, and each step kind.
A throwaway workflow lets you add an agent, If, Find records, and For each step; delete it after.

## Already done

- K1a stopped buttons that are direct `Stack` children, and a segmented control or button in a stacked
  `Field`, from stretching. The shared-CSS half of this finding is done.
- K2 added `DetailColumn measure="page"`.

## The fix

The inspector is a form about one thing, filled top to bottom, so `Field` stack is right and
`SettingRow` is not.

- `plugins/workflows/src/client/editor/NodeInspector.tsx:139-285`, `DefinitionInspector.tsx:19`, and
  `InputsInspector.tsx:28`: a header `Toolbar` with the kind icon, `Heading level={2}` (the step name,
  **Definition**, or **Inputs**) carrying the kind description as `help` ([07-8](./07-8-say-it-once.md)),
  the kind `Badge`, and the step's delete and move controls ([07-17](./07-17-buttons.md)). Model it on
  `plugins/workflows/src/client/runs/NodeDetail.tsx:273-282`.
- Cap the form with `DetailColumn measure="page"` if the inspector sits in a `DetailColumn`. If it does
  not, say so in your notes rather than forcing it.
- Drop `size="sm"` from inspector fields: `FieldControl.tsx`, `TypedValueField.tsx:35`,
  `AgentNodeForm.tsx`, and the rest.
- Number fields take `width="narrow"` (`DefinitionInspector.tsx:56, 60`).

## Copy

Inspector rows that no other finding owns. Rows for limits, required fields, and units are
[07-15](./07-15-forms-agree.md)'s; fold titles are [07-7](./07-7-folds.md)'s; summaries and the
preview are [07-8](./07-8-say-it-once.md)'s. All paths are under `plugins/workflows/src/client/editor/`.

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `NodeInspector.tsx:160-161` | Workflow step unavailable / … Its saved settings remain below. | Rewrite | Step unavailable / … Its settings are kept below. |
| `NodeInspector.tsx:205` | Wait on another step… | Keep | |
| `NodeInspector.tsx:259` | Add For each for these records | Rewrite | Run a workflow for each record |
| `DefinitionInspector.tsx:23-25` | Posture / An autonomous run passes a human gate without stopping, so it needs a tool ceiling. / Gated, Autonomous | Rewrite, keep one line inline | **Approvals**: "Stop and ask" / "Skip". Inline: "To skip approvals, set a tool limit below." |
| `DefinitionInspector.tsx:30-37` | Highest risk allowed / No ceiling, Read, Write, Execute | Rewrite | **Riskiest tools allowed**: No limit, Read only, Read and write, Anything, including commands |
| `DefinitionInspector.tsx:43` | One name per line. Leave it empty to allow every tool inside the risk ceiling. | Rewrite | One tool name per line. Leave it empty to allow any tool under the limit. |
| `InputsInspector.tsx:29` | What the run is started with. A prompt reaches one as ${inputs.name}, and so does any string in a step's own settings. | Move to `help` on **Inputs** | Values you give the workflow when it starts. Use one in a prompt as ${inputs.name}. |
| `InputsInspector.tsx:36` | A letter, then letters, numbers or underscores. | Rewrite | Start with a letter. Use only letters, numbers, and underscores. |
| `InputsInspector.tsx:48` | string, number, integer, boolean, object, array | Rewrite | Text, Number, Whole number, Yes or no, Object, List |
| `InputsInspector.tsx:68` | Add an input | Keep | |
| `AgentNodeForm.tsx:39` | Which agent runs this step. The node's own profiles. | Remove | |
| `AgentNodeForm.tsx:46, 64` | The workflow default / The harness default ({value}) | Rewrite | Workflow default / Default ({value}) |
| `AgentNodeForm.tsx:74` | This harness is not installed on this node, so its model and thinking levels cannot be listed here. | Rewrite | This agent isn't installed on this computer, so its models can't be listed. |
| `AgentNodeForm.tsx:83, 91-92` | A shared step runs in the task's own checkout beside its siblings. Its own worktree gives it a child task and a branch, which is what a step that writes code needs. / Shared task, Own worktree | Rewrite, move to `Field help` | Options "Task's folder" / "Own worktree". Help: "In its own worktree, a step gets a child task and branch. Use it for steps that change code." |
| `AgentNodeForm.tsx:99-100, 108-110` | Upstream output / Append puts what every step it waits on returned after the prompt. Only where referenced expects the prompt to place them itself. / Append, Only where referenced, None | Rewrite, remove hint | **Earlier results**: "After the prompt" / "Where I reference them" / "Leave out" |
| `StepConfigurationFields.tsx:44-45` | Plugin unavailable. Saved settings remain as raw JSON until it returns. / This step kind has not described its form, so its settings are raw JSON. | Rewrite | The plugin isn't on this computer. Its settings are kept as JSON. / This step has no form, so its settings show as JSON. |
| `FieldControl.tsx:55` | Open a task to list these | Keep | |
| `FieldControl.tsx:66, 188` | Not set | Keep | |
| `PromptField.tsx:39, 44` | What this step should do. / Insert | Keep | |
| `BranchesField.tsx:35` | One verdict per branch. Every target has to wait on this step. `default` is taken when nothing else matches. | Move to `help` on **Branches** | Each answer the agent gives leads to a step. A branch called default catches anything else. |
| `BranchesField.tsx:66` | verdict (placeholder) | Rewrite | Answer |
| `BranchesField.tsx:75` | Nothing waits on this step yet, so there is nowhere for a branch to go. | Rewrite | Add a step after this one to give a branch somewhere to go. |
| `ConditionEditor.tsx:108` | This condition contains a nested group. It is preserved; use the Code view to edit that advanced shape. | Rewrite | This condition has nested groups. Edit it on the Code tab. |
| `ConditionEditor.tsx:67` | This advanced comparison value is preserved. Edit it in the code view, or enter a fixed value here. | Rewrite | This value comes from another step. Edit it on the Code tab, or type a fixed value. |
| `ConditionEditor.tsx:121` | Add a workflow input or a structured predecessor before configuring this condition. | Rewrite | To set a condition, add an input, or a step before this one that returns fields. |
| `ConditionEditor.tsx:70, 122` | Remove condition / Choose condition / Add condition | Keep | |
| `GateFormEditor.tsx:40-43` | Fields the reviewer checks and corrects before approving. A later step reads the approved values under /values. | Move to `help` on **Form** | The reviewer checks these values and can correct them before approving. Later steps can use what they approve. |
| `GateFormEditor.tsx:53` | The values the reviewer sees. Remove every field to go back to a plain gate. | Keep the second sentence | The plan overrules the area file's "remove": it is the only way to learn how to go back to a plain gate. |
| `GateFormEditor.tsx:55` | Proposed from | Rewrite | Filled in from |
| `SchemaFieldEditor.tsx:88` | Describe the fields the agent returns. These names and types are checked before the step completes. | Move to `help` on **Result schema** | The fields the agent must return. acorn checks them before the step finishes. |
| `SchemaFieldEditor.tsx:72, 73` | No fields declared yet. / Add field | Keep | |
| `SchemaFieldEditor.tsx:20` | string, number, …, list | Rewrite | The same words as the inputs editor. |
| `WorkflowDispatchForm.tsx:79` | Changing the target preserves compatible bindings so the edit is reversible. | Remove | |
| `WorkflowDispatchForm.tsx:80` | Choose a saved workflow. / This workflow is not available to the selected project. | Keep | |
| `WorkflowDispatchForm.tsx:84-85` | {key} (not available) / {name} (draft) | Keep | |
| `WorkflowDispatchForm.tsx:93` | This child is still a draft. Publication will review it with the parent. | Rewrite | This workflow isn't published. It gets published with this one. |
| `WorkflowDispatchForm.tsx:43` | This input is not declared by the selected workflow. | Rewrite | The chosen workflow doesn't have this input. |
| `WorkflowDispatchForm.tsx:107` | Item key pointer / Needed only for ordinary arrays. Source records already have stable identity. | Rewrite, move to `Field help` | **Item ID field**. Help: "Only for plain lists. Records from a source already have an ID." |
| `WorkflowDispatchForm.tsx:111` | Title template / Optional. Acorn otherwise uses the record title or identity. | Rewrite | Task title / Optional. Leave empty to use each record's title. |

`ConditionEditor.tsx:106` ("Choose a typed field, … name the If and Otherwise destinations below.")
waits for 07-21c's two fixed branch rows, which are deferred.

## What earlier batches give you

- **`DetailColumn measure="page"`** (K2's P13). Caps the content at `--page-measure` (720) and starts
  it at the column's start edge. Chrome bars are not capped.
- **`help` on `Heading` and `Field`** (K3). On a `Heading` the mark sits on the title's line.
- **`Text` at 12px for every emphasis** (K1b's P7).

## Risk and checks

- Before you start, confirm whether the inspector sits in a `DetailColumn`.
- Changing field sizes reaches every step kind's form, including plugin-contributed ones drawn by
  `FieldControl`. Open each kind.
- Screens: the inspector for Definition, Inputs, and each step kind.
- Tests: `plugins/workflows` (`WorkflowEditor.test.tsx`, `NodeList`, `draft`).
