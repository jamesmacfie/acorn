# Generated reference pages

This page covers the public site's reference pages that read their facts from the code: the command
line reference, the keyboard shortcuts reference, the configuration file fields, the environment
variables, and the published JSON Schemas. Read it when one of those pages fails the build or a test,
or when you add a command, a shortcut, a field, or an `ACORN_*` variable. It's part of
[the public site](../site.md).

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
both for every file.
