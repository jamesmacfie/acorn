# 07-7. Every group in the inspector is an uppercase fold

**Status:** done 2026-10-02 on `more-ui`. Batch B07a. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

**Tools**, **Execution limits**, **Budget**, **Form**, **What it returns**, **Result schema**, each
condition, and each input are `Fold level="group"`, about 20 call sites under the editor. They take the
uppercase label treatment, so where the label is content it shouts it: an input called `version`
reads **VERSION**. Folds nest three deep in a result schema, each another uppercase label. The
inspector reads as a list of shouted headings, in the densest form in the app.

## Where to see it

Workflows › any definition › **Definition** (open its folds), **Inputs** with one input, and a **Wait
for a person** step with a form.

## Already done

- K2 aligned the group inset, so a fold's label now shares the column's edge.
- K1a wrote the rule in `docs/ui-design.md` § Shell hierarchy: a `Fold` or `SectionHeader` whose label
  is a path, a name, or a sentence uses `level="sub"`.

## The fix

Every `Fold level="group"` under `plugins/workflows/src/client/editor/`:

- A fold whose label is content (an input's name, a schema field, a condition) becomes `level="sub"`.
- A form section (**Tools**, **Limits**, **Form**) becomes `SectionHeader level="sub"` with its fields
  under it, not a fold.
- Only optional groups (**Advanced**, **What it returns**) stay folded, at `sub`. **Result schema** is
  optional, so it is a sub fold.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `DefinitionInspector.tsx:28, 53, 65` | Tools / Execution limits / Budget | Rewrite | Tools / Limits / Budget |
| `WorkflowDispatchForm.tsx:106` | Advanced child settings | Rewrite | Advanced |
| `NodeInspector.tsx:275` | What it returns | Keep | |

## Risk and checks

- Before you start, grep the editor folder for `level="group"` and list every site.
- Screens: Definition with folds open, Inputs with one input, a gate step with a form, an agent step
  with a result schema.
- Tests: `plugins/workflows`.
