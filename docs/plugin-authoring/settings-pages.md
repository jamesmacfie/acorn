# Settings pages

This page covers the manifest keys that place a plugin's settings page, make it findable, and put the
**Show in left rail** switch on it. It's part of [the manifest](./the-manifest.md).

## Placement

A `settings` frame takes three optional keys that say where it sits and what it affects:

- `category` is the rail group: `general`, `agents`, `connections`, `features`, `automation`, or
  `machines`. Without one, the page is filed under **Features**. The other three groups, Workspaces
  and projects, Plugins, and Advanced, hold acorn's own pages.
- `settingsScope` is what a change on the page affects, named in the page's header: `device`, `node`,
  `workspace`, or `project`. Without one it's `node`. A `workspace` or `project` page has no rail row:
  it's a tab on every workspace's or project's settings page. A `project` page's binding carries that
  project's `projectId`.
- `glyph` is the page's icon, a Lucide name or a `brand:` mark.

The compiled `SettingsContribution` spells the second and third as `scope` and `icon`. A frame keeps
`settingsScope`, because `scope` on a frame already means a pane's task or project scope. The older
`group` key is still read: `workspace` means `settingsScope: "workspace"`, and `general` means the
defaults.

A value outside these lists doesn't drop the page. The page registers in its default place, and the
roster reports the key as one this version of acorn doesn't recognize. None of these keys needs a
newer `apiVersion`.

## Search

Two keys make the page findable from the settings search and the palette:

- `keywords` is up to 16 words someone might type that aren't in the page's label, such as
  `["error tracking", "dsn"]`.
- `sections` is up to 16 `{ id, label, keywords? }`, one per `SettingsSection` your tree draws, in the
  order it draws them. Each is a search result reading **Page › Section** and a deep link,
  `settings/<page id>#<section id>`, that scrolls to the section. `id` is letters, digits, `.`, `_`,
  and `-`, and must match the `id` of the `SettingsSection` in your tree.

```js
frames: [{
  target: 'settings', id: 'sentry-telemetry', label: 'Sentry export', category: 'machines',
  keywords: ['error tracking', 'dsn'],
  sections: [{ id: 'export', label: 'What to send', keywords: ['sample rate'] }],
  layout: 'single', regions: { body: { kind: 'remote', entry: 'settings' } },
}]
```

A compiled page's sections also take `rows`, the labels of the rows in each section. A manifest has no
`rows`, because an index of what a sandboxed tree draws would have to read the tree. A list past its
limit costs the page its search entries, never the page, and the roster reports it.

The kit nodes a settings page uses, `SettingsSection` and `SettingRow`, draw a labeled placeholder on
an acorn that predates them, so raise the floor of your `apiVersion` range if you use them
([pages and the save model](../frontend/settings-pages.md)). A frame always reads the active Node, so
its header names that Node as plain text, without the Node switcher core's pages have.

## The plugin strip

acorn draws a strip above your page: your plugin's name and origin, **Manage plugin**, the **Enabled**
switch, and a line when the plugin is off, waiting for approval, failed, or offline
([the plugin strip](../plugins/activation.md#the-plugin-strip)). Don't draw your own enable switch or
status line.

To put the **Show in left rail** switch for one of your sources on the strip, name the source in
`railSourceVisibility`. The host draws the switch and keeps the preference, so your tree never reads
or writes it:

```js
sources: [{ id: 'board', label: 'Board', glyph: 'layout-dashboard', order: 50, items: '/v1/p/board/items', showInRailByDefault: false }],
frames: [{
  target: 'settings', id: 'board-settings', label: 'Board', railSourceVisibility: ['board'],
  layout: 'single', regions: { body: { kind: 'remote', entry: 'settings' } },
}]
```

- `showInRailByDefault: false` on a source starts its icon hidden. The source still registers, its
  commands and panes still work, and the palette offers **Open <label>**. The person's choice wins
  over the default. Absent means shown.
- `railSourceVisibility` lists up to 16 of your own source ids. An id that names a core source or
  another plugin's source is reported in the roster's `unknown` list, as
  `contributions.frames.<id>.railSourceVisibility: '<source>' is not one of this plugin's sources`,
  and gets no switch. The page stays. A compiled page that names one throws when its plugin registers.
- Without `railSourceVisibility`, the switch is still under **Settings > Plugins > Rail and surfaces**.

Neither key needs a newer `apiVersion`. An older acorn strips both and shows the icon.
