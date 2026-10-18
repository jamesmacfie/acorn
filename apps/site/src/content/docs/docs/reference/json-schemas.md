---
title: JSON Schemas
description: The four JSON Schemas acorn publishes, their addresses, and how to point an editor or a validator at each.
sources:
  - packages/plugin-types/acorn-plugin.schema.json
  - packages/plugin-types/acorn-device.schema.json
  - packages/plugin-types/package.json
  - packages/create-acorn-plugin/index.mjs
  - apps/cli/schemas/resources-v1.schema.json
  - apps/cli/schemas/error-v1.schema.json
  - apps/site/src/pages/schemas/[...file].ts
  - docs/cli.md
  - docs/shell/process.md
checked: 'e7c7447f7'
---

acorn publishes a JSON Schema for each file format you might write or read by hand. This page lists
them, says what each covers, and shows how to use one in your editor or a script.

| Schema | Address | What it describes |
| --- | --- | --- |
| Plugin manifest | `https://acorn.sh/schemas/acorn-plugin.schema.json` | A plugin's `acorn-plugin.json`. |
| Device config | `https://acorn.sh/schemas/acorn-device.schema.json` | `acorn.json`, the settings file for one device ([Configuration files](/docs/reference/configuration-files/#the-device-config-file)). |
| Command line resources | `https://acorn.sh/schemas/cli/resources-v1.schema.json` | What `acorn … --output json` writes on success. |
| Command line errors | `https://acorn.sh/schemas/cli/error-v1.schema.json` | What `acorn … --output json` writes to standard error when a command fails. |

Each file is served from the address in its own `$id`, and is the same file the code checks itself
against. The plugin manifest and device config schemas also ship in the `acorn-plugin-types` npm
package, as `acorn-plugin.schema.json` and `acorn-device.schema.json`.

## Use a schema in your editor

Add a `$schema` key to the file. Editors that read JSON Schema, VS Code among them, then complete keys
and show each field's description as you type:

```json
{
  "$schema": "https://acorn.sh/schemas/acorn-device.schema.json",
  "themeFollowSystem": true
}
```

A plugin made with `npm create acorn-plugin` already has the key in its `acorn-plugin.json`. acorn
keeps keys it doesn't know when it writes `acorn.json`, so `$schema` stays there after you change a
setting in the app.

To match a file without editing it, map the schema to the file name in your editor instead. In VS Code,
that's `json.schemas` in your settings:

```json
{
  "json.schemas": [
    { "fileMatch": ["acorn.json"], "url": "https://acorn.sh/schemas/acorn-device.schema.json" }
  ]
}
```

## Validate command line output

The two command line schemas describe the `acorn.cli/v1` output format
([The command line](/docs/automation/the-command-line/#read-the-output)). A script that wants to
fail loudly on a shape it doesn't expect can check each answer, for example with
[Ajv](https://ajv.js.org/):

```sh
acorn task show "$TASK_ID" --output json > task.json
npx ajv-cli validate --spec=draft7 -s resources-v1.schema.json -d task.json
```

The resource schema describes one resource. A `list` command writes an array of them, so check each
item. The two command line schemas are JSON Schema draft 7, and the other two are draft 2020-12.

## Limits

- The schemas describe the version of acorn this site describes. Every resource the command line
  writes carries `"apiVersion": "acorn.cli/v1"`, so a script can check which format it's reading.
- A schema can't say everything the code checks. The plugin manifest has rules that span several
  fields, which acorn checks when it loads the plugin.
