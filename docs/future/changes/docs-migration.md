# Docs migration: every document under `docs/` that changes, and when

Part of [docs/future/changes/](./README.md). A phase is not done until the owning doc says the new
true thing. This file says which document owns each behaviour afterwards and which phase rewrites
it. Paths were checked on 2026-09-07.

## By document

| Document | Section | Phase | Change |
| --- | --- | --- | --- |
| `docs/diff-rendering.md` | § Data flow | 0 | "The changes pane's list is a navigator" stays. Add: the list stages through a checkbox per row and per group, and the three default groups. Drop the sentence about the per-file git actions staying on the rows; they moved to the row's overflow menu. |
| `docs/diff-rendering.md` | § The source port | 0 | The status resource replaces the changes resource behind `contentSignature`. One sentence. |
| `docs/panes.md` | § Shipped panes | 0 | The `changes` row's surface reads "worktree diff, staging, commit, and remote actions". |
| `docs/panes.md` | § Layout model | 2 | The changes pane joins Notes as a worked example of state that must outlive a region: the commit draft in the model. |
| `docs/plugins.md` | § Hooks | 2, 3 | The `before-commit` payload gains `amend`; `before-push` gains `force`. The example block for `before-push` updates. |
| `docs/plugins.md` | § Cooperative extension points | 5 | `changes:push-actions` joins the list of first-party remote points, with its props. |
| `docs/state-ownership.md` | § Scope rules | 1, 2 | Two rows: the changes view preference is device state; the commit draft is a device-local draft under the drafts decision. |
| `docs/command-palette-and-shortcuts.md` | § Plugin shortcuts | 2 | `changes.commit` and `changes.amend` as the worked example of a pane chord gated on a focused editor. |
| `docs/agent-tools.md` | § Contribution | none | Unchanged. No tool is added. |
| `docs/first-party-plugins.md` | the `changes` row | 4 | The plugin consumes `core.models`, which is a second reason it is compiled and the row says so. |
| `docs/integrations.md` or the model providers section that owns it | consumers of `generateText` | 4 | The commit message route joins the database plugin's SQL route as a consumer. |
| `docs/testing.md` | smoke checklist | 0, 2, 3 | Stage through a checkbox and watch the diff column switch area; commit with nothing staged; pull a branch that is behind; force push and watch the arm. |
| `docs/security.md` | § Process, path, and configuration | 3 | Force push is `--force-with-lease` and vetoable; the abort verb only appears while an operation is in flight. One paragraph. |
| `docs/future/README.md` | the programmes table | now | This folder's row. |

## What this folder deletes when done

Nothing under `docs/`. This folder itself shrinks phase by phase: a shipped phase's file becomes a
pointer to the owning doc and is deleted when the pointer is the only content, as the other
programmes do. [02-zed-survey.md](./02-zed-survey.md) goes with the last phase; the prototype goes
with phase 3, when the real panel is the better reference.
