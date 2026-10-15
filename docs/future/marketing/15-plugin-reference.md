# Phase 15: generate the plugin reference

Date: October 15, 2026. Status: proposed. Needs phases 2 and 3. Phases 16 and 17 depend on it.

## Goal

A plugin author can look up any manifest field, contribution, permission, context member, bridge call,
extension point, or limit, and find its exact type, its bounds, what it does, and a working example.
The facts come from the code at build time, so the reference can't disagree with the host. The same
descriptions show up as hover text in the author's editor, because they live in the published JSON
Schema.

## Starting point

- `packages/protocol/src/plugin/contract.ts` assembles the manifest schema from the descriptor modules
  in `packages/protocol/src/plugin/manifest/`. The field explanations are code comments written for
  maintainers. The generated `packages/plugin-types/acorn-plugin.schema.json` has seven descriptions in
  about 119 KB.
- `packages/plugin-types/src/pluginSchema.test.ts` regenerates that schema from the contract and fails
  on any difference. It notes that the cross-field rules have no JSON Schema form, so the Node's parse
  is the real gate.
- `packages/node-core/src/server/agentTools/pluginAuthoring.ts` already derives the vocabulary an agent
  needs from the same sources: the manifest keys, caps, enums, and verbs, the limits, `NODE_CORE_FACETS`,
  and `PUBLIC_EXTENSION_POINTS`. Its comment says the vocabulary is derived rather than written, for the
  same reason this site wants it.
- The published declarations are hand-written and contract-tested: `packages/plugin-types/src/public.ts`
  for the Node context, and `packages/plugin-sdk/src/public.ts`, `packages/plugin-sdk/src/remote/public.ts`,
  and the SDK's data and testing entries for the client.
- `tools/arch/publishedPluginSurface.snapshot.txt` pins the published names.
- `packages/plugin-types/README.md` says the host speaks plugin API major 4. `PLUGIN_API_MAJOR` is 5.
- [Contribution kinds](../../contribution-kinds.md) is the internal table of every contribution, held
  to the code by `tools/arch/contributionKinds.test.ts`.

## Changes

### 1. Put the descriptions in the contract

Give every field in the manifest contract an author-facing description with Zod's `.meta({ description
})`, which `z.toJSONSchema` writes into the schema. One or two sentences each, written to
[voice](./voice.md): what the field does, and the one thing an author gets wrong. Keep the maintainer
comments as comments. They answer a different question.

Regenerate the schema with `UPDATE_PLUGIN_SCHEMA=1`. Add an assertion to `pluginSchema.test.ts` that
every property in the generated schema has a description, so a new field can't land without one.

The payoff is twice over. The site reads the descriptions, and every author whose manifest names the
schema in `$schema` gets the same text as hover help in their editor.

This touches every descriptor module, so do it in batches by module, with a review per batch. The
behavior of the parse doesn't change. `.meta` only adds metadata.

### 2. Share the derivation

Move the pure derivation in `pluginAuthoring.ts`, the part that turns the schema and the constants into
keys, caps, enums, verbs, and limits, into a function the agent tool and the site both call. Put it in
`packages/protocol` if its inputs all live there, and leave the facet list in `node-core` where it's
declared. The agent tool's output must not change. Its tests are the check.

### 3. Generate the pages

Add `apps/site/scripts/reference.mjs` (new), run before `astro dev` and `astro build`. It writes MDX
into a Git-ignored folder inside the docs collection, so the generated pages get the sidebar, search,
and, in phase 19, `llms.txt`, like any written page. Each generated page merges facts from code with a
written part from `apps/site/src/content/reference/` (new folder): an introduction, examples, and
mistakes. A generated page with no written part fails the build.

Generate these pages:

| Page | Facts from code | Written part |
| --- | --- | --- |
| Manifest reference | Every top-level key: type, required, bounds, pattern, default, and description. | How the manifest, the client entry, and the Node entry fit together. A complete minimal manifest. |
| One page per contribution key | The key's cap, every field with its type, bounds, and description, and the action verbs it accepts. | What it adds to acorn with a specimen of what the host draws, a minimal example, a full example, how the terminal client handles it, and the guide that uses it. |
| Permissions | The grantable `permissions.api` scopes, the `permissions.events` channels from `packages/protocol/src/transport/nodeEvents.ts`, the `permissions.node` facets and grants, and each kind of grant the trust prompt lists, from `packages/protocol/src/plugin/grants.ts`. Each row is marked **Enforced** or **Declared**. | What the person sees in the trust prompt, as a specimen, and why a permission is asked for at install rather than at use. |
| The Node context | Every member of `NodePluginContext` and its facets, with signatures and doc comments, from the `acorn-plugin-types` declarations. | The lifecycle: `init`, `ready`, and `dispose`, and the route namespace at `/v1/p/<id>/`. |
| The client bridge | Every export of the SDK's main, remote, data, and testing entries, with signatures and doc comments. | The handshake, its budgets, and the isolation facts: the frame origin, no network, and one message port. |
| Trees and events | The kit node names, the 12 semantic events, and the protocol version from `packages/protocol/src/tree/nodes.ts`. Export the event list there if it isn't exported. | The batch rules and what's dropped on the way to a sandbox. |
| Extension points | Every entry of `PUBLIC_EXTENSION_POINTS`: ID, kind, mode, maximum, matching key, props, actions, and terminal behavior. | An example per point, with a specimen where the point takes a tree. |
| Action verbs | The verb unions from the descriptor modules. | Which contributions take which set, and why descriptors never run plugin code. |
| Limits | Every bound: tool schema size and depth, output bytes, timeouts, context section budgets, bundle size, state size, and bridge rates. | What happens when a limit is hit. |
| Compatibility and versions | `PLUGIN_API_MAJOR`, through an `<ApiMajor />` component. | The exact promise and what isn't promised, from [refused](./refused.md#things-the-site-wont-say). |

Read declarations with the TypeScript compiler API, which the repository already depends on. Don't add
a documentation generator with its own theme and its own idea of page structure.

For a contribution the host draws from a descriptor, such as a context menu row or a top bar badge, the
specimen draws the kit node the host uses, and its caption says so.

### 4. Check the examples

Every manifest example on the site, in a reference page or a guide, is either a code region imported
from an example plugin or a fenced block marked as a manifest. A test collects them all, wraps each
fragment in a minimal manifest, and parses it with the real `pluginManifestShape`, so cross-field rules
are checked too. A fragment that should fail, such as a mistake shown on purpose, is marked so and must
fail.

Add the coverage checks from [sync](./sync.md#coverage-checks): every top-level key and every
`contributions` key has a page with at least one example, and every public extension point has one.

### 5. Publish the schemas

Serve `/schemas/acorn-plugin.schema.json` and `/schemas/acorn-device.schema.json` from the files in
`packages/plugin-types`, copied at build. Send them with a JSON content type and
`Access-Control-Allow-Origin: *`, because editors fetch them from other origins. Check in a test that each
file's `$id` matches the URL it's served at.

### 6. Fix the drift on the way

Change `packages/plugin-types/README.md` so it doesn't state the major as a number. Search the repository's
published READMEs for any other hard-coded major and do the same.

## Out of scope

Guides and tutorials, which are phases 16 and 17. Internal-only members of the compiled context. The
reference describes what a loaded plugin can use.

## Acceptance

- Every property in the published schema has a description, and VS Code shows it on hover in a
  scaffolded `acorn-plugin.json`.
- On a scratch branch, adding a field to a descriptor module and its description makes the field appear
  on the reference with no other change. Revert the branch afterwards.
- The coverage checks pass, and each fails on a planted gap.
- Every manifest example on the site parses with the real contract.
- The `plugin_authoring` tool's output is unchanged by step 2.
- `apps/site/public/_headers` gives `/schemas/*` the JSON content type and the open CORS header, and the
  built `dist/schemas/` holds both files. Checking the live headers with `curl -I` needs a deploy, so
  [phase 20](./20-launch.md) does it.

## Risks

Step 1 is the biggest single edit in this programme and it lands in the protocol package. Batching by
module keeps reviews small. The schema snapshot test makes every batch's effect visible in the diff.
