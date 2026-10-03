# Frontend

The renderer is a SolidJS application bundled into the desktop app. It loads from `app://acorn`, not
from a Node origin, and can't make direct network requests. Read this page for how the renderer is put
together and to find the topic page that owns a part of it.

Third-party UI can emit a tree of shared components or run in a sandboxed frame. Trees work on the
desktop and in the terminal client. Frames own their DOM and run only on the desktop, so use a frame
for UI that needs browser APIs, and declare the host requirement
([plugin UI choices](./plugin-map.md#the-four-shapes-a-plugin-can-take)).

## Composition

`apps/desktop/src/client/index.tsx` creates the renderer runtime and mounts `App.tsx`. The runtime
installs the client plugin host, scoped persistence, query clients, broker event handling,
notification sources, and the shell registries before rendering.

`index.html` loads the entry directly as a module, so the page preloads every startup chunk and links
the stylesheet from the head. Before the entry runs, the page runs `apps/desktop/public/startup-guard.js`,
a deferred classic script, which runs first because deferred and module scripts run in document order.
When a startup module throws, fails to parse, or can't be fetched, the guard draws an **Acorn could not
start** screen with the error and a **Reload** button, instead of a blank window. The guard is a file
because the renderer policy is `script-src 'self'`. It isn't a module, because an entry that imports
the app dynamically adds a serial fetch in front of the whole graph and loses its preloads.

`App.tsx` composes the top bar, TabRail, main view, task view, notices, overlays, Node gate, and
appearance. It selects a Node-aware cache scope and keys task content by Node and task, so a switch
disposes the previous task's scope.

The top bar, left rail, pane switcher, and task list are exclusive slots. Each has a core provider and
may have plugin offers, and a device preference picks one. `App.tsx` builds the top bar's workspace,
project, breadcrumb, and fleet data, and `TabRail.tsx` builds the rail's source list and markers. Host
verbs keep navigation, source order, rail collapse, and preference writes out of plugin code. The rail
and top bar each lend one nested slot reference, `rail.taskList` and `topbar.right`, and a remote tree
can place only the reference it was given.

`packages/client-core/src` has four folders, in dependency order:

- `kit/` is the design system: components, role tokens, the diff toolkit, and the key primitives. It
  takes props and draws DOM, and an architecture test holds it there, because `@acorn/plugin-api/ui`
  re-exports it.
- `infra/` is browser machinery: the platform seam, persistence, stylesheets, the highlighter, and the
  Node client.
- `host/` is the plugin host: registries, layouts, frames, trees, trust, and the palette.
- `features/` is the product, one folder per view: tasks, workspaces, projects, diff, editor, settings,
  fleet, dashboards, integrations, notifications, tabs, and agent. A file whose folder you can't guess
  belongs here.

## Reactivity

Solid's `on()` runs whenever its source returns a new identity, even if the value is equal. So when an
effect should run only on a real change, derive a memo of the value that matters, such as a JSON
string, and pass that to `on()`. A prop is a getter, not a memo, so an effect that reads a prop runs
whenever anything upstream changes. Guard against an identical value before touching the DOM
([how the kit is built](./ui-design/kit-internals.md#markdown-renders-block-by-block)).

## Pages

<a id="registries-and-plugins"></a>
<a id="the-desktop-gate-audit"></a>

[Registries and plugins](./frontend/registries.md) covers the client plugin host, contribution
registries, slots, the three gates, and the platform seam's verbs.

<a id="rail-source-visibility"></a>

[Rail and routing](./frontend/rail-and-routing.md) covers rail source gates and visibility, rail
markers and node stats, the router, core URLs, and how a source claims tasks.

<a id="node-data-access"></a>
<a id="typed-data-authoring"></a>
<a id="startup-readiness"></a>
<a id="connection-and-freshness-ui"></a>

[Data and startup](./frontend/data-and-startup.md) covers the API client and query cache, typed data
authoring, startup readiness, and connection and freshness UI.

<a id="shell-state"></a>
<a id="telemetry"></a>
<a id="restore-and-persistence"></a>
<a id="processing-and-responsiveness-telemetry"></a>
<a id="node-shell-navigation-lifetime"></a>
<a id="preview-pane-lifetime"></a>

[Shell state](./frontend/shell-state.md) covers the shell's views, overlays, focus, the bell, restore
order, renderer telemetry, and Node and preview lifetimes.

<a id="settings"></a>
<a id="search-and-deep-links"></a>
<a id="keys-inside-settings"></a>

[Settings](./frontend/settings.md) covers the settings layer, its rail and groups, the page context,
search and deep links, and keys inside settings.

<a id="pages-and-the-save-model"></a>
<a id="forms-and-flows"></a>

[Settings pages](./frontend/settings-pages.md) covers how a settings page saves and how its forms and
flows are shaped.

<a id="workspaces-and-projects"></a>
<a id="agents"></a>
<a id="connections"></a>
<a id="plugins"></a>
<a id="the-plugin-strip"></a>

[Settings groups](./frontend/settings-groups.md) covers the Workspaces and projects, Agents,
Connections, and Plugins pages, and the plugin strip.

<a id="startup-budget"></a>

[Startup budget](./frontend/startup-budget.md) covers the build checks on what each client loads
before it draws.
