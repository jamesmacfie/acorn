# The manifest

This page is the reference for `acorn-plugin.json`'s top-level keys, the dependency list, and the
rules that check one field against another. Read it while you write a manifest. It's part of
[plugin authoring](../plugin-authoring.md). Each block has its own page:

- [Contributions](./contributions.md): the contribution keys, their caps, and the action verbs.
- [Permissions](./permissions.md): what the node half and the frame may reach.
- [Settings pages](./settings-pages.md), [UI contributions](./ui-contributions.md), and
  [extensions](./extensions.md).
- [Harnesses](./harnesses.md) and [custom agents](./custom-agents.md).

## The manifest

`packages/protocol/src/plugin/contract.ts` is the schema. The Node parses it from disk and the client
registers contributions from the same shape. The generated JSON Schema is
`packages/plugin-types/acorn-plugin.schema.json`, and the scaffold points `$schema` at it, so your
editor completes and checks the file.

| Key | Required | What it is |
| --- | --- | --- |
| `id` | Yes | Matches `/^[a-z][a-z0-9-]{1,31}$/`: 2 to 32 characters, lowercase, no dots. It names your route prefix, your data directory, and your SQLite file, so keep it stable |
| `name` | Yes | The name people read, 1 to 120 characters. Settings, the shortcut sheet, and the tool list show it in place of the id. Trust prompts still show the id |
| `version` | Yes | A free-form string, 1 to 64 characters. The installer's downgrade guard compares it |
| `baseline` | Yes | Exactly `"acorn-1"`. Anything else is rejected before the plugin runs |
| `apiVersion` | Yes | A range over plugin API majors that covers this Node's major, which is `"3"` (`packages/protocol/src/plugin/apiVersion.ts`). Write `"3"`, a list such as `"2 \|\| 3"`, or a span such as `"2-4"` |
| `icon`, `icons` | No | Your logo as `{ d, color? }`: one SVG path `d` string authored in a 24 by 24 box, and an optional six-digit hex color. `icons` is a map of up to 16. They register as `brand:<id>` and `brand:<id>/<key>`, and any contribution can name them as its `glyph` |
| `node` | No | Relative path to the ESM entrypoint the Node imports. Leave it out for a client-only or descriptor-only plugin |
| `client` | No | Relative path to the single client file. Leave it out for a plugin with only descriptors and document surfaces. It then has no bytes to trust and no trust prompt |
| `migrations` | No | Relative path to the Drizzle chain ([storage](./storage.md)) |
| `$schema` | No | The editor schema URL. The loader doesn't fetch it |
| `emits` | Defaulted | Up to 32 `{ verb, description }` entries. Other plugins subscribe to `plugin:<id>:<verb>` ([events](../plugins/events.md#hearing-another-plugin)) |
| `requires` | Defaulted | `{ plugins: [{ id, version? }] }`, up to 16 entries. See below |
| `permissions` | Defaulted | [Permissions](./permissions.md). Leaving it out means an empty declaration, not a full one |
| `contributions` | Defaulted | [Contributions](./contributions.md) |

The three path fields go through one check: no leading `/` and no `..` segment. The loader then
resolves each one inside the package directory with lexical and symbolic-link confinement
(`resolveInRoot`). A path that's hostile from the start fails at parse time, and one that becomes
hostile through a link fails at load time.

Any other top-level key is stripped and reported as unrecognized, so a manifest written for a newer
acorn still loads ([forward compatibility](../plugins/forward-compatibility.md)).

### Requiring another plugin

If your plugin uses another plugin's capability, say so:

```json
"requires": { "plugins": [{ "id": "agents" }, { "id": "workflows", "version": "2 || 3" }] }
```

The Node checks the list once every package on disk has been read, so directory order doesn't
matter. A requirement is met by anything present under that id: a compiled plugin, another installed
package, or a client-only one. A package whose requirement isn't met doesn't load, and its roster row
names the missing id. A dropped package can't satisfy anyone, so a chain of dependents fails with it.

`version` is a range over the required plugin's own major, in the same grammar as `apiVersion`. A
compiled plugin has no version, so a range against one is ignored.

Your plugin initializes after the ones it names, so a capability the provider registers in `init`
exists by the time yours runs. A package can't require itself or name the same id twice. Nothing gets
installed for you: there's no resolver, so the owner installs both packages and this checks the
result.

### What the builder normally supplies

`apps/node/scripts/build-plugin.mjs` generates a repository plugin's manifest from its
`acorn-plugin.config.mjs` and fills in fields the config never states. In a hand-written manifest,
they're yours:

| Field | Builder's value | Hand-written value |
| --- | --- | --- |
| `id` | The plugin's directory name in `plugins/` | Write it, and match the `name` your node entrypoint exports |
| `version` | Read from the plugin's `package.json` | Write it |
| `baseline` | `ACORN_BASELINE` | `"acorn-1"` |
| `apiVersion` | `PLUGIN_API_MAJOR` | `"3"`, or a range covering it |
| `node` | `./dist/node.js` | Your own path, such as `./node/index.js` |
| `client` | `./dist/client.js`, when a client is declared | Your own path, such as `./client.js` |
| `migrations` | `./migrations`, when the config declares a chain | Wherever your chain is |

The builder emits only the runtimes the config declares. A client-only plugin names `client` and
leaves out `entry` and `factory`, and removing a node entry also removes the old `dist/node.js`. A
Solid tree that uses the published SDK sets `client.treeModule: 'acorn-plugin-sdk/remote'`, so the
JSX transform targets the runtime the plugin imports.

The builder copies `name`, `icon`, `icons`, `emits`, `permissions`, and `contributions` from the
config unchanged, so a repository config is a faithful example of those blocks. It doesn't write
`requires`, so a repository plugin can't declare one through its config.
`plugins/http/acorn-plugin.config.mjs` is the widest one that owns tables, and
`plugins/model-providers/acorn-plugin.config.mjs` is the narrowest, with `contributions: {}`.

## Cross-field rules

These rules catch a manifest that parses and then does nothing:

- Every path in every descriptor is confined at parse time to `/v1/p/<id>/`, your own namespace
  (`server/plugins/manifestValidation/references.ts`). The frame bridge applies the same rule at
  runtime.
- An `openPane` must name a task-scoped pane this manifest declares, and a `navigate` must name a
  project-scoped one.
- A project-scoped pane needs a `routes` entry, its only address, and a source whose `onSelect`
  navigates to it, its only mount site.
- An `overlay` needs an action or a companion extension that opens it.
- A `surfaceAction` may name only a pane that draws a frame or tree region of its own.
- A webview and a `coreSlot` surface need a client bundle.
- An extension point must hang off a `pane` this manifest declares, one per location.
- An `extensions` entry's `point` must be a `<pluginId>:<pointId>` reference. Its `items` or `route`
  must be your own, and either needs a `node` half.
- A `taskChecks` entry and a `schedules` entry need a `node` half.
- A `harnesses` entry's `spawn` names exactly one of `command` and `entry`, may carry `requires` only
  beside an `entry`, and needs a `node` half if it declares `probes`.
- A `dataSources` entry with `inputs` can't also declare `providerId`. It names at most eight
  inputs, each a `<pluginId>:<sourceId>` ([derived sources](../data-sources/derived-sources.md)).
- No id may repeat across contributions.
