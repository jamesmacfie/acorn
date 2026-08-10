# Rollbar-as-loaded-plugin — closed review findings

Rollbar has moved out of both compiled composition lists and is now a loaded package: node and
client bundles, native descriptor rows, a sandboxed detail frame, `id: "rollbar"` preserved so
provider ids, route paths, task links and stored connections carry over.

This folder is the review record for that work. All four findings are resolved.

| # | Change | Original severity | Status | File |
| --- | --- | --- | --- | --- |
| 1 | Ship, seed, update and remember removal of bundled plugins | **Blocker** | Resolved | [01-distribution-gap.md](./01-distribution-gap.md) |
| 2 | Bind task origins and task-link connections to the supplying plugin | High | Resolved | [02-origin-spoofing.md](./02-origin-spoofing.md) |
| 3 | Scope external-project mappings to caller-owned providers | Medium | Resolved | [03-external-projects-scope.md](./03-external-projects-scope.md) |
| 4 | Make the reference frame use Solid and the shared styled UI kit | Medium | Resolved | [04-frame-ui-toolkit.md](./04-frame-ui-toolkit.md) |

The common rule is now explicit in code: plugin-supplied ids are claims; host-bound ownership is the
authority used before a claim can cross into core state.

## What came out right

Worth stating, because the hard parts are the ones that went well:

- **The dogfood test is green again.** `apps/node/test/integration/pluginLoader.test.ts` passes,
  and Rollbar is now the only Rollbar contribution rather than a disk copy shadowing a built-in.
  `pnpm test` is back to the three documented environmental failures (`serviceSpawn` ×2,
  `standaloneShutdown`); `pnpm lint` is green.
- **The fetch seam has a real caller** for the first time. `ctx.providers.integration(provider,
  createRollbarFetch(ctx.core.projects))` is the shape the whole loaded tier was built around, and
  it had none until now.
- **The permission set came out minimal, and the record of what was *not* needed is the valuable
  part**: no `tasks` facet, no events, no prefs, no `exec`, no project config, no project writes,
  and — notably — no task *write* scope on the frame, because creation and linking stay in the
  host-owned promotion flow. That is the evidence that the tier's grants are cut at roughly the
  right joints.
- **The descriptor trade-off was found honestly rather than worked around.** The rail lost
  Rollbar's connection/level/environment filters and its project picker, and the response was to
  move exploration into the frame and say so, not to grow the descriptor vocabulary until it
  became a UI framework. That restraint is what keeps the closed verb set closed.
- **The dual-action gap was closed in the host, not the manifest.** A row needed click-to-open and
  `+TASK`, and rather than adding plugin callbacks or a second action verb, the host now reads the
  row's existing `task` block as its promotion capability and draws the affordance itself. One
  fewer thing a plugin can get wrong.

## What is still owed, beyond these findings

- **linear, http, database and editor were not moved.** All four remain in both composition lists.
  Their migration briefs are back in this folder — [linear.md](./linear.md), [http.md](./http.md),
  [database.md](./database.md), [editor.md](./editor.md) — each with a note at the top correcting what
  the rollbar migration changed underneath it. `http` carries the only analysis of the
  plugin-migrations path, which nothing has exercised. The rollbar brief itself was not restored; this
  file plus `plugins/rollbar/` is the reference now.
- **`agentContexts` has a manifest form**, so http and database are no longer blocked on the carrier.
  A descriptor names two routes in the plugin's own namespace — `options` (GET) and `capture` (POST) —
  and the host binds everything a plugin should not: `source` from the plugin id, the capture time,
  and the byte measurement the 512 KiB ceiling is checked against. `revision?()` deliberately has no
  form: it is synchronous and a descriptor answers across a fetch.
- **Editor's blockers are now named rather than vague**: its `overlay` component slot and its
  `persistedState` slice have no manifest form, and whether an unminified Monaco frame fits under the
  8 MiB client-bundle cap is unmeasured. That last one gates database too, which also depends on
  `monaco-editor`.
- **Release validation**, as the moved doc already noted: a real-token soak and an installer-driven
  update. Finding 1 is a precondition for the second of those.
