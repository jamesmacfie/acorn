# Generated reference pages

This page covers the public site's reference pages that read their facts from the code: the command
line reference, the keyboard shortcuts reference, the configuration file fields, the environment
variables, the published JSON Schemas, and the plugin reference. Read it when one of those pages fails
the build or a test, or when you add a command, a shortcut, a field, an `ACORN_*` variable, or anything
to the plugin contract. It's part of [the public site](../site.md).

## The command line reference

`apps/site/scripts/cliHelp.mjs` runs the built `acorn` launcher with `--help`, then once for each
command the overview's usage lines name, and serves the text as `virtual:acorn-cli-help`.
`CliReference.astro` draws it. The site runs the binary rather than importing `apps/cli/src/args.ts`,
because apps don't import each other, and this way the page can't say anything the binary doesn't.

`pnpm --filter @acorn/site build` and `dev` build `@acorn/cli` first. Without a built command line,
the build fails and says to run `pnpm --filter @acorn/cli build`. A new command appears on the page
with no site change, once its usage line is in the overview's help.

## The keyboard shortcuts reference

There's no one table of default shortcuts: core, each client, and each plugin register their own,
mostly when a component mounts. `apps/site/scripts/keybindings.mjs` reads every `defaultChord` and
`toggleChord` in client-core, the desktop client, the terminal client, and the shipped plugins, as
text, and takes the description, category, and scope from the object around it. A pane's own chord
reads as "Show the *label* pane". The bundled packages' manifest keybindings come from their
`acorn-plugin.config.mjs`. `KeyboardReference.astro` draws a table per category, and a separate set for
the terminal client's own keys.

`apps/site/scripts/keybindings.test.mjs` fails when a registration has a description, category, or
scope the script can't read, such as one built from a variable, and when an entry in `OVERRIDES`
matches no registration. To fix the first, write the field as a literal, or add an override keyed
`<file> <chord>` with the words the page should show.

## Configuration file fields

- **The device config file.** `DeviceConfigReference.astro` draws a row for each property of
  `packages/plugin-types/acorn-device.schema.json`, from its `description`. The descriptions come from
  `.describe()` on `deviceConfigSchema` in `packages/protocol/src/device/deviceConfig.ts`, and
  `packages/plugin-types/src/deviceConfigSchema.test.ts` fails when a top-level property has none.
- **Workflow files.** `WorkflowFileReference.astro` draws `WORKFLOW_FILE_TABLES` from
  `plugins/workflows/src/contract/workflowFile.ts`.
  `plugins/workflows/src/server/definitions/workflowFile.test.ts` writes a definition that sets every
  field, and fails when the file it writes holds a key the table doesn't
  describe, or the table describes a key neither the writer nor the loader knows. Add a key to the
  writer and the table together.

## Environment variables

`apps/site/scripts/envVars.mjs` finds every `ACORN_*` name in the Node, the command line, the terminal
client, and `@acorn/custody`, tests left out. `envVars.test.mjs` fails when a name is neither on the
Environment variables page nor in `INTERNAL`, with the reason it isn't documented, and when the page
lists a name nothing uses. Add a variable a person might set to the page, and one only acorn sets to
`INTERNAL`.

## The JSON Schemas

`apps/site/src/pages/schemas/[...file].ts` serves each `*.schema.json` in `packages/plugin-types/` at
`/schemas/<file>`, and each in `apps/cli/schemas/` at `/schemas/cli/<file>`, byte for byte. Each file's
`$id` is the address it's served at, and a Playwright test in `apps/site/tests/site.spec.ts` checks
both for every file. `apps/site/public/_headers` sends `/schemas/*` as JSON with
`Access-Control-Allow-Origin: *`, because editors fetch them from other origins, and
`apps/site/scripts/headers.test.mjs` checks that block.

## The plugin reference

Every page under **Build plugins > Reference** except Examples and What plugins can't do is generated.
`apps/site/scripts/reference.mjs` runs before the site's `dev`, `build`, and `lint`, and writes each page
into the docs collection's `build-plugins/reference/` folder, which Git ignores. Run
`pnpm --filter @acorn/site reference` to rebuild them while `astro dev` is running. A page joins two
halves:

- **The written half**, in `apps/site/src/content/reference/`, at the same path: the frontmatter, the
  introduction, the examples, and the mistakes. Edit this file, never the generated one. It holds a
  `{/* facts */}` line where the facts go, writes no imports, and may use the components the script
  imports into every page, `PAGE_COMPONENTS`. `@API_MAJOR@` in a written half becomes
  `PLUGIN_API_MAJOR`, so an example manifest never holds the number. A link to a docs page that's still a
  draft keeps its words and loses the link until that page publishes.
- **The facts**, from `apps/site/scripts/referenceFacts.mjs`. The manifest and contribution tables come
  from `manifestJsonSchema()` and `pluginManifestVocabulary()` in
  `packages/protocol/src/plugin/vocabulary.ts`, the same derivation the `plugin_authoring` tool uses.
  Each field's text is its `.describe()` in the contract, which is also the hover help in an author's
  editor. The Node context and the client bridge come from the published declarations, read with the
  TypeScript compiler. Values owned where plain Node can't import them, such as the frame scopes in
  client-core and the bridge budgets, are read from their source text, and a read that finds nothing
  fails the build.

A contribution key gets its own page, `contributions/<key-in-kebab-case>`, and the build fails until its
written half exists. A page with facts and no written half fails the same way.

Three checks hold the reference to the contract:

- `packages/plugin-types/src/pluginSchema.test.ts` fails when any property in the manifest schema has no
  description. Add `.describe()` beside the field, then regenerate with `UPDATE_PLUGIN_SCHEMA=1`.
- `apps/site/scripts/referenceExamples.test.ts` parses every manifest example in the plugin docs with the
  Node's own `pluginManifestSchema`, cross-field rules included. A fenced block marked `json manifest`
  must parse, one marked `json manifest-invalid` must fail, and an unmarked JSON block holding manifest
  keys fails the test. An example leaves out `id`, `name`, `version`, `baseline`, and `apiVersion`, and
  the test adds them, with `acme` as the ID.
- The same test fails when a top-level key has no example on the manifest reference, a contribution key
  has none on its page, or a public extension point has none on Extension points.
