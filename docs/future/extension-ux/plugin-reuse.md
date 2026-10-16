# Plugin reuse passes

Follow-up passes on the [sidebar rework](./README.md), so everything the sidebar draws is a part a
third-party plugin author can reuse, ideally the same component the desktop and the terminal draw.

## Pass 1

October 17, 2026. A pass so a third-party plugin gets what a first-party one gets in the sidebar, and
the sidebar draws with the kit's parts, fixed in the kit where they were broken.

- **Panel header.** A header's `detail` reads as one rule: the first line bold, every later line
  muted. The sidebar no longer draws a line holding "→" in monospace for GitHub's branches.
  [Browser panel](../../plugin-authoring/browser-panel.md) states the rule.
- **Handoff glyph.** A handoff descriptor takes an optional Lucide `glyph`, which the issue card
  draws before the kit's mark for the plugin or a document. The example plugin `acme-browser` sets
  one. [Browser handoffs](../../plugin-authoring/browser-handoffs.md) documents it.
- **Copy button.** The kit's `CopyButton` rules moved from `copy.css` into `primitives.css`, so the
  button is styled wherever the kit's sheet loads. `copy.css` is gone; its two other rules styled
  classes nothing used. The panel's link rows use `CopyButton`. The export ceiling didn't change. The
  dev build's **Copy Acorn link** stays an `IconButton`, because it stands in for **Open in Acorn**
  beside two icon buttons and its tip shows the link.
- **Fold marker.** `Fold`'s triangle, and a tree row's twist, size from `--bw-marker`, not
  `--marker-w`, so Modern and Cute show them on the desktop too. Cozy's triangles grow from 2 to 3
  pixels.
- **Kit fixes out of `sidebar.css`.** A menu item's note now gives way before its label in the kit.
  Segmented controls fit their container and wrap a long label. The `spin` keyframes moved beside the
  kit rules that use them. The sidebar's plain button and field rules now skip the picker's
  `repo-picker-` parts and `CopyButton`, so kit pickers look as on the desktop and two patches went.
  Markdown rules that repeated the kit's are deleted. Kept as the sidebar's own: the setting control
  width, which is the kit's token for a narrow host, and the narrower segment inset in Add a site.

Proposals not done:

- **Real plugin logos.** A manifest already carries its logo as path data in `icon` and `icons`. The
  handoff list could carry it to the sidebar, which would register it as `brand:<id>`, so a glyph is
  needed only as a fallback. Cost: a field from node-core's handoff list through the bridge, the
  sidebar's registration, and tests, about five files.
- **A shared panel renderer.** Moving `PanelHeader`, `Block`, and the severity table into
  `@acorn/client-core` as `BrowserPanelBlocks` would let the desktop or the terminal show a panel.
  Cost: one moved component and its tests. It waits for a host that wants a panel.
- **Kit buttons for the sidebar's last plain buttons.** About 20 plain `<button>`s remain, in the
  top bar, banners, and the request form. Moving them to the kit's `Button` and `IconButton` would
  delete the sidebar's controls block of about 40 lines and its exclusion list. Cost: about ten
  files, the tests that find them by class, and a screenshot pass.
- **`CopyButton` sizes.** A size matching `IconButton` and a tip line for the copied text would let
  **Copy Acorn link** use it. Cost: two props in the kit and the terminal host.

[Pass 2](#pass-2) did all of these but the shared panel renderer.

## Pass 2

October 17, 2026. A pass so a plugin's logo, the sidebar's buttons, and its copy action are the parts a
plugin uses everywhere.

- **Plugin logos.** The Node's discovery read now lists `icons`: the manifest `icon` of each plugin that
  declares a handoff or a panel. The bridge passes on the ones that meet the manifest's own rule in
  `handoffs.list`, and the sidebar registers each as `brand:<pluginId>`, as the desktop's client does.
  A third party's issue card shows its logo as GitHub's does, and a panel's `glyph` can name
  `brand:<pluginId>`. Pass 1's handoff `glyph` is gone from the schema, the editor schema, the example
  plugin, the docs, and the tests. It never shipped, and the logo covers it.
- **Kit buttons.** The sidebar's 20 plain buttons are the kit's `Button` and `IconButton`. The button
  block in `sidebar.css` and its exclusion list for kit parts are gone. Go to task, a task's title, and
  Needs you keep their look as `bare` kit buttons styled under a wrapper class, because the style packs
  leave `bare` alone. The top bar's icon buttons draw their mark at the icon size in the text colour, as
  before. Screenshots of the built sheet in Terminal and Modern, dark, match the old ones. Buttons in
  banners and strips now take the kit's outline look, which in Modern has the subtle fill.
- **`CopyButton`.** It takes `size`, which draws it as an `IconButton` of that size that's always
  shown, and `tipSub`, the tip's second line. The terminal's copy takes both and ignores them, and
  prints `title` as its label rather than always "Copy". The development build's icon **Copy Acorn
  link** is a `CopyButton` with the link as its tip line. The labelled form, in place of **New task in
  Acorn**, stays a kit `Button`, because `CopyButton` draws only the mark.
- **Tool tones.** The transcript's tool marks take their colour from the agents plugin's
  `agentToolTone`, which now takes any status.

What the sidebar draws, and who else draws it. The desktop and the terminal both run the agents and
workflows plugins' own client components through their kit hosts. The sidebar runs no plugin code, so
it draws its own from the agents and workflows contracts.

| Sidebar component | Built from | Desktop or terminal counterpart |
| --- | --- | --- |
| `Settings`, `Sites`, `AddSite`, `WorkflowForm`, `OpenInAcorn`, `TopBarMenus` | Kit parts only | Desktop Settings uses the same kit rows |
| `TopBar`, `NeedsYouButton` | Kit buttons, own bar layout and three wrapper rules | App chrome, not plugin-facing |
| `GoToTask` | Kit `PickerRow` and the picker's classes, own list and footer | The desktop command palette |
| `Home`, `TaskRow`, `PageTaskRow` | Kit `Row`, `Picker`, `Field`, own filter field | The desktop's task rail |
| `Agents`, `SessionRow`, `AgentPicker` | Kit `Row`, `Section`, `Picker`; `runtimeIcon`, `runtimeTone` | `AgentTaskSidebar`, `RuntimeStateIcon`, `ProviderGlyph` |
| `Conversation`, `Message`, `ToolRun`, `Composer` | Kit `Card`, `Fold`, `Chip`; own tool lines, chips, field | `AgentTranscript`, `AgentEventCard`, `AgentComposer` |
| `Requests`, `NeedsYou` | Kit `Card`, `Button`, `CodeBlock`, `Row`; own plain fields | `AgentRequestCard` |
| `Runs` | Kit `Row`, `Card`, `Section`; workflows' `statusDisplay` | The workflows plugin's run pane and `RunGraph` |
| `Handoff` | Kit `Card`, `Picker`, `Field`, `Button`; own item head | None: only the sidebar shows handoffs |
| `PluginPanel` | Kit `Section`, `Row`, `Badge`, `Log`, `CopyButton`; own header layout | None: only the sidebar shows panels |
| `Pairing` | Kit `EmptyState`, `Button`, settings rows; own install command | Desktop node pairing in Settings |
| `State` | Its own dot and word | The kit's `StatusDot` |

Proposals not done:

- **The agents plugin's own components in the sidebar.** Exporting `RuntimeStateIcon`,
  `ProviderGlyph`, the transcript cards, or the request card isn't cheap: apps may import only a
  plugin's `contract/`, the components import the kit through `@acorn/plugin-api`, whose barrels the
  sidebar avoids, and they read the Node through the plugin's own client. The sidebar shares their
  decisions instead, through `runtimeState`, `toolTone`, and `providerMarks`. Cost: moving each into
  `@acorn/client-core` as a kit part, or giving the sidebar a bridge-backed agents client, which
  changes the desktop's files and needs a review of each part's desktop behaviour.
- **Kit `StatusDot` for the sidebar's state dot.** `State` and the top bar's dot would use the kit's
  dot, and seven lines of `sidebar.css` would go. Cost: mapping `bad` and `idle` to the kit's tones in
  `state.tsx` and three call sites. The idle ring becomes the kit's faint dot, a visible change.
- **Kit fields for the last plain inputs.** Go to task's filter, Home's filter, the request form, and
  the composer's field are plain elements, so the field rules keep their exclusion list for kit parts.
  Cost: four files, and `pnpm dev:extension:ui fill`, which finds fields by name.
- **A shared panel renderer**, from pass 1, still waits for a host that wants a panel.
