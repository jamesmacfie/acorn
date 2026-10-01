# 07-10. Problems show before anyone types, twice, in one run-on line

**Status:** not started. Batch B07a. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

A new **Run a command** step's Command box is red with "This one has to be filled in." before you
have typed anything. The footer lists "step 'command' needs Command step 'command' needs command":
the client's required-field check and the node's validator report one problem twice with different
casing, and the links run together with a 6-pixel gap. The clean state reads "Valid · 1 nodes ·
1 roots".

## Where to see it

Workflows › any definition › add a **Run a command** step and leave Command empty. Read the footer at
the bottom of the editor.

## Already done

- K2's P12 gives a bar `Toolbar` that closes a grow `Stack` a top divider. The editor's problem bar
  is the one match, so the footer already has its rule on top.

## The fix

This is the client part. Rewriting the validator's strings for people is deferred, because they feed
the authoring model's repair list (`generationRequest.ts:78, 114`), a click-to-select matcher
(`WorkflowEditor.tsx:391`), and tests.

- `plugins/workflows/src/client/editor/WorkflowEditor.tsx:150-155`: de-duplicate the client's
  `missing()` (`draft.ts:268`) against the server's problems, case-insensitively, by step and field.
- `FieldControl.tsx:88-89, 107` and `PromptField.tsx:20, 29`: a field's error shows after it is
  touched, or after **Publish…** or **Run…** is pressed.
- `WorkflowEditor.tsx:382-407`: the footer shows one problem and a count ("… · 2 more").
- The clean state reads "{n} steps, no problems".

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `WorkflowEditor.tsx:386` | Valid · {n} nodes · {n} roots | Rewrite | {n} steps, no problems |
| `WorkflowEditor.tsx:402` | and {n} more | Keep | |
| `FieldControl.tsx:107`, `PromptField.tsx:29` | This one has to be filled in. | Rewrite | Fill this in. (Shown after the field is touched.) |

Held: `FieldControl.tsx:88`'s appended "Required." waits with the required-field convention
([07-15](./07-15-forms-agree.md)). The validator rows ("workflow has no steps", "step '{name}' needs
{field}", and the rest) are deferred.

## Risk and checks

- Before you start, read both problem sources and confirm their shapes still differ only in casing.
- The footer list is clickable to select a step. Keep the click working on the one problem shown.
- Screens: a new command step before and after typing, the footer with several problems, and a clean
  workflow.
- Tests: `plugins/workflows` (`WorkflowEditor.test.tsx`, `draft`).
