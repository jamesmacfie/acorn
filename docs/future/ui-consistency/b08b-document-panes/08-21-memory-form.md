# 08-21. The memory form: misaligned fields, three words for one choice, and a toast that prints a path

**Status:** not started. Batch B08b. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

The "+ memory" form in Context puts **Name**, **Type**, and **Scope** in a centred `Inline`, so
**Name**'s label sits 17 pixels above the other two because it has a hint. The hint says
"kebab-case", but the code slugifies the name itself. One choice has three wordings: "project (this
project only)" and "private (every project)" here, "This project" and "Across projects" in the proposal
review, and "private" on the memory card. **Save memory** is sm outline with no **Cancel**. Saving
toasts a four-line file path.

## Where to see it

**Review changed files** › **Context** › the Memory section's "+ memory". Render the form and stop.

**Never press Save.** The memory plugin writes the real `~/.acorn/memory` under the user's home
folder, not the session's data root.

## Already done

- K3's 00-19 fixed the field's accessible name ("Namekebab-case"): `Field` now labels only its caption.

## The fix

- `plugins/memory/src/client/MemorySection.tsx:31-93`: a `Stack` of `Field`s. Drop the "kebab-case"
  hint (the code slugifies at `:38`). Scope reads **This project** or **All projects**. Type labels in
  sentence case. **Save memory** solid md and **Cancel** ghost md. The toast says "Memory saved".
- `FindingsBundleReview.tsx:15, 20, 152-156` and `MemoryCenter.tsx:70-75`: the same scope words.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `MemorySection.tsx:58` | + memory | Rewrite | Add memory, with a `plus` icon |
| `MemorySection.tsx:66` | kebab-case (hint) | Remove | |
| `MemorySection.tsx:67` | name (placeholder) | Remove | |
| `MemorySection.tsx:70` | convention, architecture, … | Rewrite | Convention, Architecture, Decision, Fix, Reference, Feedback, Task, About you |
| `MemorySection.tsx:76` | project (this project only) / private (every project) | Rewrite | This project / All projects |
| `MemorySection.tsx:81` | one-line description | Rewrite | What the agent should know, in one line |
| `MemorySection.tsx:84` | Body — include a **Why:** line. | Rewrite | The details. Say why, so the agent knows when it applies. |
| `MemorySection.tsx:44` | Saved → {path} (toast) | Rewrite | Memory saved |
| `FindingsBundleReview.tsx:20` | Applies to this project / Applies across projects | Rewrite | This project / All projects |
| `MemoryCenter.tsx:72` | private | Rewrite | All projects, with no warn tone (the plan's overrule on row 730) |

## Risk and checks

- Before you start, read the safety note above. Check the form by rendering it, and check the save
  path by test, never in the app.
- Screens: Context with the memory form open.
- Tests: `plugins/memory`.
