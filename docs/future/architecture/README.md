# Architecture deepening plans

What came out of the August 2026 architecture review of the plugin runtime. The review produced seven
plans; **all of them are now landed or decided** and their files are deleted — the code and its
comments are the record. Nothing here is open work. Keep the file for the section below, which exists
so nothing gets re-suggested.

A few words the review used with a specific meaning:

- **Module** — a file or small cluster of files with one job.
- **Interface** — everything a caller has to know to use a module. **Deep** means a small interface
  hiding a lot of work; **shallow** means the interface is nearly as complicated as the code behind it.
- **Locality** — bugs live where code is *called*, not just inside the functions themselves. A pure
  function with tests proves little if the wiring around it is untested.

## What landed or was decided (so nothing re-suggests it)

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
- **5 — frame verbs.** Type-level coverage assertions in `frames/verbs.ts`; the header comment
  there is the decision record. Deliberately NOT built: deriving `FrameServices`/the SDK from the
  vocabulary — don't re-propose the derivation unless a second consumer of the vocabulary appears
  (a second host shell, say).
- **6 — frame wiring out of `.tsx`.** The file extension was deciding test coverage: the client
  suites run in bare Node with no Solid transform, so `frames/register.tsx` (nine registration
  branches) and `PluginFrame.tsx` (fourteen host services) could not be reached by a test, and all
  four defects this stack has shipped were in that half. Fixed by moving the decisions, not by adding
  jsdom: `frames/register.ts` is now a `.ts` file using the `lazy` + `createComponent` pattern its
  sibling `chrome/register.ts` already used, with the two surfaces that need real host markup
  (`PluginRefPanel.tsx`, `PluginOverlay.tsx`) as their own components; `frames/frameServices.ts`
  holds the service implementations that used to sit inside PluginFrame; `plugins/trustModel.ts`
  holds the tier diff and `decide`. Three new suites, 51 tests, no new test infrastructure.

  Deliberately NOT built: the descriptor/plan indirection the plan sketched (`registerPlan.ts`
  returning contribution descriptors for a `.tsx` shell to instantiate). Converting the file
  outright is a smaller diff and covers all nine branches rather than only the decisions, and the
  sibling proves the shape works. Also still not built: jsdom or a Solid test renderer — that is a
  separate decision with its own costs and nothing here needed it.
- **The plugin-api client barrel** (was plan 7) is a watch item, not a work item: 173 exports of
  pure re-export is a namespace, not a contract. The ratchet now lives in the comment at the top of
  `packages/plugin-api/src/surface.test.ts` — additions get the new-dependency question; curation
  toward fewer, deeper objects waits for real third-party usage.

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
