# Phase 15: generate the plugin reference

Date: October 15, 2026. Status: done. Needs phases 2 and 3. Phases 16 and 17 depend on it.

## Completion note

October 16, 2026. The plugin reference is generated: the manifest reference, a contributions index and
one page per contribution key (31), Permissions, the Node context, the client bridge, Trees and events,
Extension points, Action verbs, Limits, and Compatibility and versions. Every property in the published
manifest schema has a description. [Generated references](../../site/references.md#the-plugin-reference)
is the reference for how the pages are built and checked.

What landed:

- **Descriptions in the contract.** Every field in `packages/protocol/src/plugin/` and the shared schemas
  it pulls in (`chrome/commands.ts`, `data/dataSourceContributions.ts`, `runtime/schedules.ts`) has a
  `.describe()`, which `z.toJSONSchema` writes into `packages/plugin-types/acorn-plugin.schema.json`. The
  schema had no property descriptions, and now every property has one. `pluginSchema.test.ts` fails on a property with
  none. The parse is unchanged: protocol's 314 tests and node-core's 504 plugin tests pass.
- **One derivation.** `pluginManifestVocabulary()` and `manifestJsonSchema()` moved from node-core's
  `pluginAuthoring.ts` to `packages/protocol/src/plugin/vocabulary.ts`. The `plugin_authoring` tool adds
  the core facets and the bridge text on top. Its output, guide and vocabulary together, is byte for byte
  the same as on the base commit.
- **The generator.** `apps/site/scripts/reference.mjs` joins each written half in
  `apps/site/src/content/reference/` with facts from `referenceFacts.mjs`, and writes the pages into a
  Git-ignored folder of the docs collection. The site's `dev`, `build`, and `lint` run it first. The
  sidebar's Contributions group lists the per-key pages it wrote.
- **The checks.** `apps/site/scripts/referenceExamples.test.ts` parses all 97 manifest examples, one of them a mistake that must fail, with
  node-core's `pluginManifestSchema`, cross-field rules included, and holds the coverage rules from
  [sync](./sync.md#coverage-checks). Fixture cases prove each check fails on a planted gap.
- **The schemas.** `apps/site/public/_headers` sends `/schemas/*` as `application/json` with
  `Access-Control-Allow-Origin: *`, and `headers.test.mjs` checks it. Phase 14 already served both files at
  their `$id`, and the production build's `dist/schemas/` holds them.
- **The drift.** `packages/plugin-types/README.md` and `packages/plugin-sdk/README.md` no longer state a
  major. The SDK README said `2`.

The acceptance checks: a production build writes 157 pages and passes the site's tests, with 185 Playwright
tests, and a preview build passes all 294. `astro check` finds no errors. Adding a field
with a description to the slots descriptor made it appear on the slots page with no other change, and
removing it took it away.

### Decisions

- **`.describe()`, not `.meta({ description })`.** They write the same `description`, and
  `deviceConfigSchema` already uses `.describe()`.
- **Action verbs are defined once.** Each verb is one object in `chromeDescriptors.ts`, shared by the three
  verb sets, so its description is written once. The sets and their order are unchanged.
- **The example check runs under Vitest.** The Node's parser uses TypeScript that Node's type stripping
  refuses, such as parameter properties. The generator runs in plain Node, through
  `apps/site/scripts/tsResolve.mjs`, a resolve hook that retries an extensionless relative import with
  `.ts`. The site's `test` script runs the Vitest file, and so does `specimens`.
- **Facts read from source text, with a check.** The frame scopes, the bridge budgets, the trust prompt's
  groups and facet sentences, and two node-core size limits are owned where plain Node can't import them.
  The generator reads them as text and fails when a read finds nothing.
- **The facts are `ReferenceTable` rows**, as phase 6 asked, so each field has an anchor. `ReferenceTable`
  gained an `href` per row and `[words](/path/)` links in a cell. `Specimen` gained a `caption` override.
- **Written halves import nothing.** The generator imports `ApiMajor`, `Badge`, `ReferenceTable`,
  `Snapshot`, and `Specimen` into every page, so moving a page can't break a path. `@API_MAJOR@` in a written
  half becomes the major, so no example holds the number.
- **A link to a draft keeps its words and loses the link.** Every contribution page names its guide, and
  the guides are phase 16 and 17 drafts. The links appear when those pages publish, with no edit here.
- **Two export ceilings rose by one.** `@acorn/protocol` to 88 for `plugin/vocabulary.ts`, and
  `@acorn/node-core` to 67 for `server/plugins/manifest.ts` and `server/plugins/coreFacets.ts`, with the
  reasons in `tools/arch/boundaries.test.ts`. `@acorn/node-core` is a site dev dependency for those two.
- **Three exports.** `KIT_EVENTS` from `tree/nodes.ts`, and `NODE_EVENT_CHANNELS` from
  `transport/nodeEvents.ts`, so the pages read them.

### Deviations

- **The trust prompt has five groups, not two.** Besides **Enforced** and **Declared** it has **Web pages**,
  **Reads**, and **Provides**. The Permissions page shows each line kind's real group, read from
  `trustModel.ts`.
- **Specimens on three pages.** Frames shows a tree pane, sources the kit's rows, and slots the kit's
  `Badge`, each captioned as the node the host draws. A context menu row has no specimen, because the
  kit's `Menu` draws only open, which the generator can't show in jsdom. The trust prompt is shell chrome,
  so Permissions shows the `permissions` snapshot, as phase 12 did.
- **No code regions from example plugins.** No example plugin exists until phases 16 and 17, so every
  example is a fenced block. `collectExamples` in the test is the place to add regions.
- **The tree limits are on Limits**, with each one's own doc comment from `TREE_LIMITS`, read with the
  TypeScript parser.
- **What plugins can't do and Examples stay drafts.** They moved to the written folder unchanged, because
  this phase's table doesn't list them.
- **No scratch branch.** The acceptance check that adds a field ran in the working tree and was reverted,
  because this run's notes forbid new branches.
- **The `routes.path` rule.** An app route lives under `/p/:projectId/x/<id>/`, which no doc said. The
  field's description says so now.
- **The protocol package may not name the plugin route prefix**, even in prose, so its descriptions say
  "your own routes".
- **The `kind` on a command is required.** The `plugin_authoring` brief still says leaving it out means an
  action, and `docs/plugin-authoring/the-manifest.md` still says the major is `3`. Both need their owners.
- **105 of the Node context's 144 members have no doc comment** in `acorn-plugin-types`, so their rows show a
  signature only. The declarations' owner should add them.

### What later phases need to know

- Phases 16 and 17: mark every manifest example in a guide as ` ```json manifest ` or
  ` ```json manifest-invalid `. An unmarked JSON block with manifest keys fails the test. Write the
  fragment without `id`, `name`, `version`, `baseline`, and `apiVersion`, and use `acme` as the plugin ID in
  routes. Publishing a guide turns on the links to it from the contribution pages.
- A new contribution key fails the build until it has a written half at
  `apps/site/src/content/reference/contributions/<key-in-kebab-case>.mdx` with an example.
- A new field needs a `.describe()`, then `UPDATE_PLUGIN_SCHEMA=1` on the plugin-types test.
- Phase 19: the facts are `ReferenceTable` components, not Markdown tables, so `llms.txt` must render the
  page, not read its source.
- Phase 20: check the live `/schemas/` headers with `curl -I`, and that VS Code shows the descriptions on
  hover in a scaffolded `acorn-plugin.json`. The scaffold points `$schema` at `acorn.sh`, so the hover needs
  the deploy. The descriptions are in the committed schema now.
- The architecture checks fail on this base as earlier phases recorded, with nothing from this change.

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
