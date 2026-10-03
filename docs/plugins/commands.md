# Commands and keybindings

This page covers a plugin's commands, the five command kinds, keybindings, and the keys a frame may
claim. It's part of the [plugin reference](../plugins.md). The first-party catalogue is in
[command palette and shortcuts](../command-palette-and-shortcuts.md).

## Commands

Loaded-plugin commands and shortcuts are manifest data the host binds. A command id `search` becomes
`plugin.<plugin-id>.search`, so plugin code can't claim a first-party command id. `palette` controls
whether the command appears in the palette, and defaults to `true`. Keep command and binding ids
stable across versions, because the qualified binding id keys the person's saved overrides.

A compiled plugin declares the same kinds as typed objects through `ctx.commands.register`, which
stamps the owner, so a plugin can't claim another contributor's group as a parent. Its `search` gets a
live callback instead of a route. A plugin whose rows are on the device spreads `localSearch` from
`@acorn/plugin-api/client` and gets one fetch when the palette opens. A plugin asking its Node writes
`query` itself and keeps the debounce. A `setting` shares the reader and writer its Settings page
uses.

### Command kinds

A command descriptor requires `kind`. A manifest command with no `kind` is rejected, and so is the
removed `contributions.palette` key.

- **`action`** runs one verb from the narrow set the host owns ([action verbs](./descriptors.md#action-verbs)).
- **`group`** holds children and has no action. Any command may name a `parentId`, which must be a
  group in the same manifest. Cross-plugin parenting, a missing parent, a parent that isn't a group,
  and a cycle are each an install error and a dropped command on the device.
- **`search`** names a GET `route` in the plugin's own namespace and one static `onSelect` verb. The
  host debounces typing, sends `q` plus the identifier the declared `scope` owns (`taskId`,
  `projectId`, or `workspaceId`), and renders
  `{ items: [{ id, title, subtitle?, icon?, badge?, ref?, taskId?, projectId?, workspaceId? }] }`.
  `placeholder`, `minQueryLength` (0 to 20), and `debounceMs` (150 to 1,000) are optional, and the host
  shows at most 50 rows. `onSelect` takes the narrow set plus `navigate`.
- **`input`** names a POST `route` and one static `onSuccess` verb. The host sends `{ input, taskId? }`
  when the reader presses Enter and expects `{ ok: true, item?, message? }`. A failure is the ordinary
  error envelope, keeps the reader's text, and runs no action.
- **`setting`** names a GET `readRoute`, a PUT `writeRoute`, and 2 to 32 static
  `{ value, label, keywords? }` choices. The host reads the route when the palette opens and writes
  `{ value, taskId?, projectId?, workspaceId? }` when a choice is picked, and both answer `{ value }`.
  The value must be one of the declared choices, checked on the way out and back. A Boolean is two
  choices, `On` and `Off`. Secrets and free-form values need other input.

`scope` is `none`, `task`, `project`, `workspace`, or `node`, the default. A command whose scope names
an identity the palette doesn't have isn't offered. A manifest can't name `fleet`.

A route's answer never chooses behavior. Every field but the ones listed is dropped, malformed rows
are dropped one at a time, and the verb that runs is the static one the manifest declared. A search,
an input, or a setting needs a `node` entrypoint.

```json
{
  "contributions": {
    "commands": [
      { "id": "issues", "title": "Linear", "category": "navigation", "kind": "group" },
      {
        "id": "find", "title": "Find a Linear issue", "kind": "search", "parentId": "issues",
        "scope": "project", "route": "/v1/p/linear/issues/search", "placeholder": "Search issues…",
        "onSelect": { "verb": "navigate", "surface": "linear-issue" }
      },
      {
        "id": "grouping", "title": "Linear: group issues by", "kind": "setting", "parentId": "issues",
        "scope": "project",
        "readRoute": "/v1/p/linear/issues/grouping", "writeRoute": "/v1/p/linear/issues/grouping",
        "options": [{ "value": "status", "label": "Status" }, { "value": "assignee", "label": "Assignee" }]
      }
    ]
  }
}
```

The `navigate` verb in this example needs the project-scoped pane and route shown in
[loaded surfaces](./client-authoring-and-the-ui-kit.md#loaded-surfaces-in-the-manifest).

## Keybindings

A keybinding may target only a command from the same manifest, one binding per command. It uses the
canonical `meta+ctrl+alt+shift+key` spelling and must include `meta`, `ctrl`, or `alt`. `when` is
`global`, `task`, or `surface`. A loaded plugin can't request `typing-exempt`.

```json
{
  "contributions": {
    "frames": [{ "target": "pane", "id": "editor", "label": "Editor", "layout": "single", "regions": { "body": "frame" } }],
    "commands": [{
      "id": "search", "kind": "action", "title": "Editor: find in files", "category": "action",
      "palette": true, "action": { "verb": "openPane", "pane": "editor" }
    }],
    "keybindings": [{ "command": "search", "defaultChord": "meta+shift+f", "when": "surface", "surface": "editor" }]
  }
}
```

In the terminal client, the terminal emulator keeps the command key, so the host reads `meta` as
Ctrl. `meta+shift+p` is pressed as Ctrl+Shift+P. You declare the chord once
([what a plugin loses in the terminal](../tui/plugin-losses.md)).

A binding never displaces one that already works, and a plugin installed later never displaces an
earlier one. The loser is unbound and labeled. The person outranks all of it, and an explicit rebind
is honored even when it takes a core chord.

## Keys a frame claims

A frame surface may declare the modified chords its own UI handles:

```json
{ "target": "pane", "id": "editor", "label": "Editor", "claimsKeys": ["meta+f", "meta+shift+f"] }
```

The frame SDK starts with that set, and `acorn.keys.claim([...])` may narrow it at runtime but never
widen it. `meta+k`, `meta+,`, `meta+1` to `meta+9`, and `escape` can never be claimed. Every other
keydown is forwarded to the shell's dispatcher, so global and plugin shortcuts work while the iframe
has focus. Claims appear in the device trust prompt and in **Settings > Keyboard shortcuts**.
