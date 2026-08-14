# Architecture deepening plans

Seven proposals from the August 2026 architecture review of the plugin runtime — the part of the
codebase the last 80 commits cluster on. Each file explains one problem in plain language: why it
exists, how it shows up in practice, and a step-by-step plan to fix it. None of these are bugs you
can file today; all of them are places where the next bug is cheap to make and expensive to see.

A few words the docs use with a specific meaning:

- **Module** — a file or small cluster of files with one job.
- **Interface** — everything a caller has to know to use a module. **Deep** means a small interface
  hiding a lot of work; **shallow** means the interface is nearly as complicated as the code behind it.
- **Seam** — a place where you can swap one side out without the other noticing. A seam with only
  one real implementation is hypothetical; two implementations make it real.
- **Locality** — bugs live where code is *called*, not just inside the functions themselves. A pure
  function with tests proves little if the wiring around it is untested.
- **Leverage** — one change in one place improving many call sites.

## The plans

| # | Plan | Strength | One line |
|---|------|----------|----------|
| 1 | [One plugin-state bridge for both composition roots](./01-plugin-state-bridge.md) | Strong | The same eleven-field object is copy-pasted into two boot files and has already drifted apart four ways, untested. |
| 2 | [Declare the manifest once](./02-manifest-declared-once.md) | Strong | The plugin manifest shape is written twice — a Zod schema and a hand-written twin — with no test that they agree, and the trust prompt's data crosses to the desktop unvalidated. |
| 3 | [One eligibility module behind client registration](./03-client-registration-eligibility.md) | Strong | The security predicate deciding which plugin panes exist is copy-pasted between two register modules with different trust gates. |
| 4 | [Permission lines become records, not copy](./04-permission-lines-as-records.md) | Strong | The trust prompt diffs on user-facing wording, so a copy edit falsely re-prompts every owner with "asks for more". |
| 5 | [A frame-verb table](./05-frame-verb-table.md) | Worth exploring | Adding one verb to the frame bridge takes five edits in five modules; the drift this invites has already happened once. Design pass done and partly built — see [05-frame-verb-table-design.md](./05-frame-verb-table-design.md). |
| 6 | [Move frame wiring decisions out of .tsx](./06-frame-wiring-out-of-tsx.md) | Worth exploring | The test suite can't render components, so the file extension decides coverage — and all four documented bugs in this stack were in the untested `.tsx` half. |
| 7 | [The plugin-api client barrel](./07-plugin-api-barrel.md) | Speculative | 173 exports and zero behaviour is a namespace, not a contract; a watch item, not a work item. |

## Status

Plans 1–5 have landed. 1 extracted `buildPluginStateBridge` and moved the roster reconciliation out
of its route; 2 moved the manifest schema into `@acorn/protocol/pluginContract.ts` and gave the trust
store a real parse; 3 put eligibility and the surface predicates in
`client-core/plugins/contributions.ts`; 4 turned permission lines into records keyed on the grant; 5
got its design pass and the type-level half of it (`client-core/plugins/frames/verbs.ts`). Plans 6 and
7 are untouched.

A review of that work found ten regressions, all in places where behaviour was unified rather than
moved, and all fixed. Three were about what "trusted" means: it is now the strong question ("may this
device execute these bytes"), answered only against the bundle that WON fleet resolution, from the
same roster row the manifest comes from — and the chrome pass asks the separate weaker question
(`hasWithheldCode`) so a descriptor-only package still contributes. Two were about the trust file and
IPC failing closed too broadly: acknowledgements are parsed one at a time, an unreadable file is set
aside rather than overwritten, and a disclosure this shell cannot parse no longer stops the owner
recording a decision. The rest were smaller: the unrecognised-permission count is part of its diff
key, the wire projection is loosened wherever an older node would not have sent a field, the roster
row's projection fails closed at compile time, and the task-pane classification is one exported
predicate instead of three spellings.

## Suggested order

Start with **1** — smallest diff, live divergence, and the repo has already proven the exact move
once (`buildPluginDeps` was extracted from the same two files for the same reason). Then **2**,
which is the biggest prize: it kills the highest-churn file's worst half and closes a real gap in
the trust disclosure path. **3** and **4** are independent of each other and of 1–2; either can go
whenever. **6** gets cheaper after 3. **5** deserves a design pass before any code. **7** needs
nothing except a decision not to let it grow by accident.
