# Declare the manifest once

**Strength: Strong.** The biggest prize of the seven. It shrinks the highest-churn file in the
repo and closes a real gap in the trust-disclosure path.

## The problem, plainly

A loaded plugin's manifest — its id, its contributions, the permissions it asks for — has one
authoritative definition: the Zod schema in
`packages/node-core/src/main/pluginManifest.ts` (810 lines, and genuinely well-shaped: the whole
thing hides behind two exports).

But the *client* also needs to know that shape, because the roster route sends it over the wire.
And the client can't import node-core. So `packages/protocol/src/api.ts` contains a **second,
hand-written copy** of the same types — about 330 lines, 43 exports (`PluginFrameSurface`,
`PluginChromeAction`, `NodePluginPermissions`, and forty more). The file admits it out loud at
line 314:

> "Hand-written here for the same reason NodePluginPermissions is: the node parses the manifest,
> and this is the projection the device registers contributions from."

There is **no test that the two definitions agree**. And TypeScript can't catch drift either,
because the data crosses a process boundary as `unknown` — the compiler never sees both ends of
the wire at once.

Three more facts make this worse than a tidy-up:

1. **`api.ts` is the #1 churn file in the repo.** 654 lines, 131 exports, imported by 134 files,
   touched by 27 of the last 80 commits. The plugin block is what drives that churn: every new
   manifest field means editing `pluginManifest.ts` *and* `api.ts`, in lockstep, by hand — which is
   exactly why they sit at #1 and #4 on the churn list.
2. **The trust prompt's data is never re-validated.** The permissions block — the thing the trust
   dialog renders and the owner consents to — arrives at the desktop and is stored via
   `z.custom<NodePluginPermissions>()` (`pluginTrustStore.ts:45`, `pluginIpc.ts:37`). `z.custom`
   with no validator function is a cast wearing a Zod costume: it accepts anything. So if the
   node-side schema and the hand-written wire type ever disagree, the user is shown — and their
   consent recorded against — a disclosure with no guarantee it matches what was parsed off disk.
3. **A build script parses the file with a regex.** `apps/node/scripts/build-plugin.mjs:70` scrapes
   `PLUGIN_API_MAJOR = '...'` out of the *source text* of `api.ts` because it can't import the
   built package. A god-file that is also load-bearing for a regex.

## How it surfaces

A concrete story. You add an optional `badge` field to frame surfaces:

1. You edit the Zod schema in `pluginManifest.ts`. Manifests parse, the node stores it, the roster
   route sends it. Done, you think.
2. The client's `PluginFrameSurface` in `api.ts` doesn't have `badge`. Nothing fails — the client
   just silently never sees the field, because the wire is `unknown` and the client trusts its own
   stale type. You discover this in the UI, an hour later, or a reviewer discovers it never.
3. Or the reverse: someone extends the `api.ts` type first, the client renders confidently against
   a field the node never sends, and `undefined` walks into the layout code.

The memory note "stale loaded-plugin package" records a whole afternoon lost to exactly this class
of two-places-must-agree problem. The permissions variant is the one with teeth: a drifted
`NodePluginPermissions` doesn't crash — it shows the owner a *wrong security disclosure*, and
`z.custom` waves it through.

## The plan

1. **Create the contract module.** `packages/protocol/src/pluginContract.ts` (name to taste) owns:
   the Zod manifest schema, every wire type as `z.infer` of it, and `PLUGIN_API_MAJOR`. This means
   protocol grows a Zod dependency — acceptable: Zod is isomorphic, already the repo's stated
   wire-validation tool, and protocol is precisely the package both sides may import.
2. **node-core imports the schema instead of owning it.** `pluginManifest.ts` keeps
   `readPluginManifest()` and the cross-field `superRefine` rules (route confinement, surface
   reachability — see also plan 5's cousin finding); only the structural schema moves. The
   `PLUGIN_API_MAJOR` re-export dance at `pluginManifest.ts:38` dies.
3. **Delete the twins.** The ~330-line hand-written block in `api.ts` becomes re-exports from the
   new module (to keep 134 importers compiling), then importers migrate at leisure. `api.ts` halves.
4. **Make the trust store parse for real.** Replace both `z.custom<NodePluginPermissions>()` sites
   with the actual schema from the contract module. Now the disclosure the owner consents to is
   provably the same shape the node parsed off disk.
5. **Retire the regex.** `build-plugin.mjs` reads `PLUGIN_API_MAJOR` from a tiny importable source
   file (or a `version.json` the contract module also reads) instead of regexing `api.ts`.
6. **Fold the duplicate projection.** `declared()` in `routes/plugins.ts:108` re-implements half of
   `pluginLoader.ts`'s `installedPluginInfo`. With one shared type there's no reason for two
   projections — keep `installedPluginInfo`, delete `declared()`.

No parity test is needed at the end, because there's nothing left to be at parity: one declaration,
two consumers.

## What gets better

- Every manifest change is one edit, and the compiler sees every consumer of it.
- The trust disclosure path gets an actual validation step where today there's a cast.
- The repo's worst churn magnet loses the half of itself that made it one.
- One adapter (`installedPluginInfo`) instead of one and a half.

## Watch out for

- **Boundary rules.** `tools/arch/boundaries.test.ts` polices what protocol may contain. The plugin
  roster is a core-owned `/v2/core` concern, so this move is legal — but check the rules before,
  not after.
- **Do steps 1–3 together or not at all.** Splitting the plugin block out of `api.ts` *without*
  single-sourcing it from the schema just moves the duplication to a new address.

## Files

- `packages/node-core/src/main/pluginManifest.ts:503-511` — `z.infer` exports move to protocol
- `packages/protocol/src/api.ts:312-592` — the hand-written block, deleted
- `packages/node-core/src/main/pluginLoader.ts:133`, `packages/node-core/src/server/routes/plugins.ts:108` — two projections become one
- `apps/desktop/src/app/main/pluginTrustStore.ts:45`, `apps/desktop/src/app/main/pluginIpc.ts:37` — `z.custom` replaced with the real parse
- `apps/node/scripts/build-plugin.mjs:69-71` — regex scrape retired
