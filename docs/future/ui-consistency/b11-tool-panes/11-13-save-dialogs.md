# 11-13. Two save dialogs, two ways to label a field

**Status:** not started. Batch B11. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

The Database **Save query** dialog has no field labels: the placeholder is the label ("Name — e.g.
recent paid orders"). The API **Save request** dialog uses `Field` labels with hints. **Generate SQL**'s
prompt has no label, and its two backend selects show no labels on screen.

## Where to see it

The Database pane (area 11's fake data patch) › **Save** and **Generate**; the API pane › save a
request.

## Already done

- K4b ordered both dialogs' footers (**Cancel** ghost, then the solid primary) and checked that **Save
  request** already matched.
- K1a gave every delete a "{Verb} {thing}?" label (**Delete row?**, **Delete request?**, **Delete
  variable?**).
- B06's 06-10 gives `ModelBackendPicker` visible
  labels, which reaches Generate SQL.

## The fix

- `plugins/database/src/tree/SaveQueryModal.tsx:48-81`: `Field` labels ("Name", and "Notes" with a hint)
  and `size="sm"`.
- `GenerateSqlModal.tsx:77-137`: the prompt's label is "What should the query return?". The backend
  picker shows its labels (after B06).
- `plugins/http/src/tree/SaveRequestModal.tsx:32-83`: copy only.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `GenerateSqlModal.tsx:85` | Describe the query — e.g. the 10 most recent orders with the customer's email | Rewrite, split | Label: "What should the query return?" Placeholder: "The 10 most recent orders, with each customer's email" |
| `GenerateSqlModal.tsx:91` | Example queries | Keep the label, add `help` | Help: "The model sees these saved queries as examples of how you write SQL." |
| `GenerateSqlModal.tsx:101-103` | Add example… / Filter saved queries… / No matching queries. | Keep | |
| `SaveQueryModal.tsx:53` | Name — e.g. recent paid orders (placeholder) | Rewrite, split | Label: "Name". Placeholder: "Recent paid orders" |
| `SaveQueryModal.tsx:67` | Notes — what it answers, gotchas. Sent to the AI with the query when used as an example. | Rewrite, split | Label: "Notes". Hint: "The model sees these when you use this query as an example." Placeholder: "What it answers, and anything surprising" |
| `SaveQueryModal.tsx:79` | Overwrite | Keep | |
| `plugins/database/acorn-plugin.config.mjs:122` | Capture saved SQL and the notes beside it. No connection URL or credential is stored to leak. | Rewrite | Saved SQL and its notes. Connection details are never included. |
| `SaveRequestModal.tsx:51` | Stays with this task and goes when the task does. / Filed in the project's tree, available from every task. | Rewrite | Stays with this task, and goes when you archive it. / Saved to the project, so every task can use it. |
| `SaveRequestModal.tsx:62` | Slash-separated. Leave blank for the top of the tree. | Rewrite | Use / for subfolders. Leave it empty to save at the top. |

## What earlier batches give you

- **`Field help`** (K3), for the example queries' explanation.

## Risk and checks

- Before you start, confirm B06 landed the `ModelBackendPicker` labels; if not, Generate's selects stay
  unlabelled.
- Do not press **Generate** with a real model unless you mean to; it calls a model.
- Screens: Save query, Generate SQL, and Save request (kept in the task and filed in the project).
- Tests: `plugins/database`, `plugins/http`. Rebuild both bundles.
