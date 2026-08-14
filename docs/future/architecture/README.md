# Architecture deepening plans

What remains from the August 2026 architecture review of the plugin runtime — the part of the
codebase the last 80 commits cluster on. The review produced seven plans; **plans 1–5 landed**
(commit `b732c69c`, including the fixes from its own review) and their files are deleted — the code
and its comments are the record now. What stays here is the open work and one decision record.

A few words the docs use with a specific meaning:

- **Module** — a file or small cluster of files with one job.
- **Interface** — everything a caller has to know to use a module. **Deep** means a small interface
  hiding a lot of work; **shallow** means the interface is nearly as complicated as the code behind it.
- **Seam** — a place where you can swap one side out without the other noticing. A seam with only
  one real implementation is hypothetical; two implementations make it real.
- **Locality** — bugs live where code is *called*, not just inside the functions themselves. A pure
  function with tests proves little if the wiring around it is untested.
- **Leverage** — one change in one place improving many call sites.

## What's here

| File | Status | One line |
|------|--------|----------|
| [Move frame wiring decisions out of .tsx](./06-frame-wiring-out-of-tsx.md) | **Open** | The test suite can't render components, so the file extension decides coverage — and all four documented bugs in this stack were in the untested `.tsx` half. |
| [The plugin-api client barrel](./07-plugin-api-barrel.md) | **Watch item** | 173 exports and zero behaviour is a namespace, not a contract; a curation ratchet, not a work item. |
| [Frame verbs: the design pass](./05-frame-verb-table-design.md) | **Decision record** | Why the verb table is a type-level coverage assertion (`frames/verbs.ts`) and deliberately not a derived dispatch table — don't re-propose the derivation without a second consumer. |

## What landed (so nothing re-suggests it)

- **1 — one plugin-state bridge.** `apps/node/src/server/pluginState.ts` builds the `PLUGIN_STATE`
  capability for both composition roots; the roster reconciliation moved out of its route into
  `node-core/server/plugin/pluginState.ts`; `standaloneParity.test.ts` asserts the two deliberate
  root deltas, and `docs/node-distribution.md` documents them.
- **2 — the manifest declared once.** `@acorn/protocol/pluginContract.ts` owns the Zod schema and
  the wire types; the desktop trust store parses (not casts) the permissions block;
  `build-plugin.mjs` imports `pluginApiVersion.ts` instead of regexing source, with an `engines`
  floor in the root package.json.
- **3 — one eligibility module.** `client-core/plugins/contributions.ts` owns eligibility, the
  trust gate, and the surface classification both register passes feed the `openPane` allowlist
  from.
- **4 — permission lines as records.** `PermissionLine { key, text, icon, high }`; the trust
  dialog diffs on the grant key, never the sentence.
- **5 — frame verbs.** Type-level coverage assertions in `frames/verbs.ts`; see the decision
  record above for what was deliberately not built.

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
predicate (`isTaskPaneSurface` in the protocol contract) instead of three spellings.
