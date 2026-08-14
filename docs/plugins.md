# Plugins

Plugins come in two tiers. Built-ins are first-party packages compiled into acorn and registered by
the Node/client composition roots. Loaded plugins are installed at runtime from a manifest plus ESM
bundles. Either tier can contribute Node behavior, client behavior, or both; the available carriers
and trust boundary differ by tier.

This file is the mechanism. [extensibility.md](./extensibility.md) is the reasoning — why there are
two tiers, where the line between them is, and which of the constraints below are deliberate rather
than unfinished. Read it before widening a seam.

## Package shape

```text
plugins/<name>/
  src/
    node/       NodePlugin entry, schema, and Node-owned behavior
    server/     Hono route handlers and provider logic
    main/       Electron-free runtime engines and adapters
    client/     SolidJS panes, sources, settings, and contributions (compiled-in plugins)
    frame/      the sandboxed-frame bundle a LOADED plugin's UI is instead
    contract/   narrow cross-plugin types, capability IDs, and provider contracts
    shared/     types/logic shared by this plugin's runtimes
```

Not every plugin has every directory. The built-in Claude, Codex, and Aider profiles are registered
by `plugins/agents`; there are no separate profile packages. Onboarding is a client overlay with
core setup support. The loaded Linear and Rollbar packages are integration providers that use core's
generic external-item store rather than owning a plugin database; a loaded plugin's UI lives in
`frame/` rather than `client/`, because it is a bundle for a sandboxed document and not a
`ClientPlugin`.

## The plugin API

`packages/plugin-api` (`@acorn/plugin-api`) is the only host package a plugin's production code may
import. It adds no behavior of its own: it re-exports an enumerated slice of node-core and
client-core, and `tools/arch/boundaries.test.ts` enforces both halves of that — plugins reach the
host only through the facade, and the facade only re-exports.

Six entrypoints:

| Entrypoint | What it carries |
| --- | --- |
| `@acorn/plugin-api/node` | `NodePlugin` and the context types, the route toolkit (`AppEnv`, `requireUser` and friends, `respondError`, the bridge), per-plugin SQLite and migrations, the `CoreServices` type, capability ids, provider and integration contracts |
| `@acorn/plugin-api/client` | `ClientPlugin`, the API client and query options, client events, contribution types, task/workspace/fleet state, and the design system's plain functions (`cx`, `token`, metrics) |
| `@acorn/plugin-api/ui` | Frame-safe presentation components: primitives (including the `ListDetail` two-column pane layout), `Icon`, `Picker`, `Modal`, `Tabs`, and the diff rows |
| `@acorn/plugin-api/ui/diff` | The diff model, virtualizer, hydration and find pass |
| `@acorn/plugin-api/ui/host` | Compiled-shell-only connected components and registration seams; never import this from an isolated frame |
| `@acorn/plugin-api/ui/sdk` | The framework-free sandbox bridge, including API/state/UI calls and declared key claims |

The line between `/client`, `/ui`, and `/ui/host` is drawn by the runtime, not by taste. Solid
compiles a component to code that touches `window` at module scope, so `/client` remains free of
`.tsx`. The frame-safe `/ui` barrel reaches only the pure `client-core/src/ui/` presentation tree;
router/query/registry-connected components sit on `/ui/host`. The facade is declared side-effect
free so a frame bundle retains only the named presentation components it imports. Boundary tests
enforce all three properties.

`packages/plugin-api/src/surface.snapshot.txt` pins every exported name. A change to the surface
fails that test until the snapshot is regenerated
(`UPDATE_SURFACE=1 pnpm --filter @acorn/plugin-api test`), which is the point: growing the contract
should be a deliberate act. The implementation still lives in
`packages/node-core/src/server/plugin/types.ts` and
`packages/client-core/src/registries/plugin.ts`, which stay free to move files around underneath.

Two things stay outside the facade. `@acorn/protocol` is the shared wire-type package and is
imported directly. And plugin TEST code may still reach node-core and client-core: a test that seeds
core's tables, builds a real `CoreServices` or opens a temp-directory database is reaching for the
host rather than for an API, and a second ratchet in the boundaries test reviews what it reaches.
That is a first-party privilege; a third-party author gets a testkit entrypoint if and when one is
built.

## Activation

`apps/node/src/server/plugins.ts` is the Node activation list. `apps/desktop/src/app/client/plugins.ts`
is the client activation list. The host validates unique names, applies the per-Node disabled-plugin
set, initializes enabled plugins, runs the optional ready/activation pass, and owns disposal of their
registrations.

Required plugins are agents, memory, notes, and terminal. GitHub is optional: when enabled it contributes
the provider, PR rail, importer, and mirror routes; when disabled core Home and the remaining plugins
still boot.

Optional plugins can be disabled per Node through Settings → Plugins; their SQLite files remain on
disk and can be re-enabled later.

Node initialization happens before the listener accepts requests. A plugin can register:

- routes under `/v2/p/<plugin>/...`;
- typed capabilities;
- client broadcasts through `ctx.events`;
- agent tools and task-context sections;
- integration, connection, and model-provider descriptors;
- a plugin-owned SQLite migration chain and disposal hook.

The host supplies `CoreServices` for confined filesystem access, Git, processes, secrets, tasks,
repositories, task context, model generation, preferences, and the machine identity. Plugins do not
receive the core database handle merely to query shared tables.

It supplies no HTTP client. This list named one, and none exists — see docs/http-client.md for why
that matters and when it will have to.

### Loaded plugins

A Node can also load a plugin's node half from disk, from `<dataRoot>/plugins/<id>/` — a directory
holding an `acorn-plugin.json` manifest and an ESM bundle that default-exports a `NodePlugin`. The
manifest's shape is declared once, in `packages/protocol/src/pluginContract.ts`, because the client
registers contributions from the same shape and neither side may import the other;
`packages/node-core/src/main/pluginManifest.ts` adds the cross-field rules that need `id` — route
confinement, surface reachability — and reads the file. Loaded plugins join the same
array and the same host pass as the compiled-in ones, so ordering, `ready`, capability late-binding
and disposal are identical.

Three things differ, and all three follow from the code not being ours:

- **They get there through the installer.** `POST /v2/core/plugins/install` (owner/device principal,
  `Idempotency-Key` required, audited) resolves a GitHub release, an npm package, a tarball URL or — on
  a development build — a local folder; validates the manifest; and places the package atomically with
  a hash-pinned lockfile beside it (`packages/node-core/src/main/pluginInstaller.ts`,
  docs/plugins.md). Uninstalling removes the package and, by default, leaves its
  SQLite file alone. Each device then asks its own owner before running the plugin's interface code.
- **Failures are contained.** A built-in throwing from `init` still fails the boot — it is first-party
  code in the same binary, and a node that cannot assemble should say so. A loaded plugin throwing has
  its registrations rolled back, is reported through the roster (`state: 'failed'`) and the attention
  inbox, and the node keeps starting.
- **The context is shaped by the manifest.** `permissions.node` decides which `CoreServices` facets
  and capability ids the plugin can see; `ctx.routes.register` (Hono), `ctx.events.channel` and
  `ctx.events.streams` are never present, whatever the manifest says. A loaded plugin serves routes as
  `ctx.routes.fetch(handler)` instead — a `(Request, PluginRequestContext) → Response` function. The
  request context projects authenticated identity plus a provider runtime; it exposes provider-owned
  resource, connection and external-item operations without exposing Hono, the core database, or the
  secret service. The external-item calls exist for the read no per-connection resource can express —
  the same cached item across every connection of one provider, which is how a bare ticket id gets
  attributed to a workspace — and the host binds the owner and the provider ownership check. A
  loaded integration provider likewise passes a fetch handler to `ctx.providers.integration`; passing
  Hono is an explicit initialization error. Project access is deliberately three grants:
  `projects:read` for identity, checkout paths and workspace external-project mappings scoped to
  connection providers registered by that loaded plugin,
  `projects:config` for executable build/dev/database
  configuration, and `projects:write` for creating or updating project references. The `prefs` facet
  is projected into `plugin:<id>:*`, the same namespace used by that plugin's frame `state.get` and
  `state.set` verbs; this is the supported Node-half↔frame state channel. Values are capped at 1 MiB
  from either side.

That last point is least privilege for **cooperative** code and honest disclosure for users, not a
security boundary: a loaded bundle shares the Node's process and can `import('node:fs')` and ignore
`ctx` entirely. `docs/security.md` is the full threat model, and every surface that
renders these permissions has to say *declared*, not *enforced*.

`apps/node/scripts/build-plugin.mjs` builds a repository plugin into this shape, reading the plugin's
declaration from the plugin's own package — `plugins/<id>/acorn-plugin.config.mjs`, where the directory
name is the plugin id — so a plugin's declared surface lives, and is reviewed, beside the code it
describes. Its default target is
the development data root; `--package-root` stages the same package for distribution. The desktop
build keeps its bundled roster in `apps/desktop/scripts/build-bundled-plugins.mjs`, packages the
result as read-only application resources, and asks the service to reconcile it before discovery.
Only packages recorded as app-owned are updated. An existing owner-installed version wins, and
uninstall writes a tombstone outside the package directory so a later app update does not restore it.
An unrecorded directory sitting in the plugin root is treated as owner-installed too, with one
exception: a package `build:plugin` wrote straight into the data root leaves a `.acorn-dev-build`
marker, and reconciliation treats a marked package as app-owned so a newer bundled version replaces
it. Without that, a developer's own build was indistinguishable from an installation, was recorded as
user-managed, and then quietly outlived every rebuild of the app — which presents as a feature that
does not exist. The marker is never written under `--package-root`, so nothing in a shipped resource
directory carries it, and a real install is protected exactly as before. Because an owner-installed row
is still checked first — deliberately, so a marker file cannot override ownership — `build:plugin` also
clears a `user` row for the id it is writing: that row is a claim about how the directory got there, the
script is authoritatively changing that, and without this a developer already trapped by a pre-marker
build would stay trapped through any number of rebuilds.
Packaged client bytes are trusted only after Electron main reads and hashes its own application
resource; a node cannot acquire that trust by labelling a roster row as bundled.

Four first-party packages ship this way and none is also present in the compiled composition.
Rollbar was the first production caller of the route, descriptor and frame seams. `model-providers` is
one end of the range: node-only, no client bundle, no routes, no storage, `contributions: {}` — it
registers two connection providers and two model adapters and stops, which is proof the loaded tier
costs a small plugin nothing. Linear is the widest manifest here: a pane frame plus
a `refPanel` frame that ANOTHER plugin renders, a descriptor rail source with host-owned promotion,
declarative `contentLinks`, a command and a keybinding. HTTP is the other end from model-providers —
the only one that owns TABLES, so it is the only production caller of `ctx.storage` and of a
manifest-declared migration chain, and it also serves an `agentContexts` descriptor from its own
routes. Read it for the storage seam, read linear for the two surfaces rollbar does not
exercise, and read `docs/third-party/README.md` for what all of these moves cost. The loader still supports a package id shadowing a built-in during
a staged migration; when that happens it drops the compiled copy from the graph and logs which
directory won.

### Loaded plugins: the client half

A loaded plugin's UI is not registered by its own code. The Node hands each device the plugin's
manifest and the hash of its client bundle in the roster (`GET /v2/core/plugins`); the device
decides what to render from that, and the plugin's JavaScript never touches a shell registry. Two
kinds of contribution come out of one manifest:

- **Frames** — a pane, reference panel, settings page, project importer, or full-screen overlay picker
  that the plugin draws
  itself. A `pane` declares a `scope` of `task` (the default, and what a pane has always meant: a
  rectangle in a task's layout) or `project`, in which case it is drawn beside its own rail Source's
  list at `/p/:projectId` with no task involved. A project-scoped pane must declare a `routes` entry
  addressing it and a source whose `onSelect` navigates to it — those are its address and its only
  mount site, and a manifest missing either is rejected rather than shipping a surface that can never
  appear. Each renders in an iframe on `app-plugin://<bundle-hash>`, a scheme Electron main serves
  from its content-addressed cache with `connect-src 'none'`: the frame has no network, no
  `window.acorn`, and no reach into the shell. Its only I/O is one `MessagePort`, where every call
  is checked against the manifest's declared scopes by an allowlist naming each path and method
  (`packages/client-core/src/plugins/frames/`, `scopes.ts` is the choke point). The host pins which
  Node the frame talks to; the frame cannot name one. A `refPanel` frame is one of the two surfaces whose
  surrounding chrome the host draws rather than the plugin (`overlay` is the other): an iframe cannot
  `Portal` out of the box its consumer placed it in, and the bridge's close verb does not reach a
  reference panel — it is granted to importers and overlays only — so the manifest adapter
  supplies the drawer and its dismiss control while the frame supplies the body. It is also the one
  surface no plugin *mounts*: the shell holds which ref is open and draws it in one place
  (`client-core/registries/refPanels.ts` + `refPanelHost.tsx`), so any surface that renders content can
  call `openRefPanel({ providerId, displayId })` and get any provider's panel. One at a time, on
  purpose — a stack of reference panels is a navigation history, which is what panes and routes are for
  — and `openRefPanel` returns `false` rather than opening an empty overlay when that provider has no
  panel installed on this device. A panel's props name its subject `target`, never `ref`: `ref` is a
  reserved JSX attribute that Solid compiles into a DOM setter, so a props member of that name silently
  arrives as a function instead of data. `tools/arch/boundaries.test.ts` holds the line, because
  TypeScript cannot — Solid declares `ref` on `IntrinsicAttributes`.

  The bridge's `api` surface is five verbs — `get`, `post`, `put`, `patch`, `del` — matching
  `PluginBridgeApiRequest.method` exactly. That last part is the rule rather than a coincidence: a method
  missing from the SDK facade is a method no plugin can reach, however permissive the scope table
  underneath, and `put` was missing for exactly that reason until http (whose own updates take a
  full-replacement body) could not call its own routes from its own frame.

  Two browser affordances a frame does NOT have, both worth knowing before writing one. `window.confirm`
  and `alert` are suppressed: the iframe is sandboxed `allow-scripts allow-same-origin` and deliberately
  not `allow-modals`, so `confirm()` returns false and a guarded action silently does nothing. And
  `navigator.clipboard` refuses to write, because the frame's document is not the focused one from the
  shell's point of view — `bridge.ui.copy` exists for that, and a confirmation is the frame's own UI to
  draw (two clicks, an inline undo, whatever fits) rather than a host verb.

  A link inside a frame's own rendered content reaches the shell through `bridge.ui.openUrl(url)`,
  because the anchor itself cannot go anywhere: the iframe has no `allow-popups` and Electron pins every
  subframe to its own origin. The frame passes a URL and learns nothing back. The host validates the
  scheme at the boundary — `https` only, the same policy a manifest's `openUrl` descriptor verb is held
  to (`@acorn/protocol/externalUrl.ts`), so `file:`, `javascript:`, `data:` and the frame's own
  `app-plugin://` origin are all refused. A navigation must also be a person's act: the verb is honoured
  only while the frame itself holds focus — which a real click or keypress inside its document gives it —
  and at most once per second, so background code cannot move the reader and a hostile frame cannot spam
  the browser. A frame using `openLinkOnClick` satisfies both for free. Then the host runs the same
  content-link ladder every shell surface
  runs: in-app when a recogniser claims the URL, the owner's browser otherwise. *Which* in-app
  presentation is inferred from the calling surface, not asked of the frame: a link clicked inside a
  reference panel swaps that panel's subject, and one inside a pane opens the pane. The SDK's
  `openLinkOnClick(bridge, event)` is the delegated anchor handler on top of it, so a frame does not
  hand-roll the plumbing; unlike the shell's equivalent it takes modified clicks too, because in a frame
  there is no browser default for cmd-click to preserve.
- **Document surfaces** — a pane whose editor the **host** draws, with the plugin supplying only the
  document. A `pane` surface may declare a `layout` block. Two templates exist: `document`, where the
  whole pane is one text document, and `document-over-frame`, where that document sits above the
  plugin's own frame with a host-owned drag handle between them.

  ```json
  {
    "contributions": {
      "frames": [{
        "target": "pane", "id": "scratch", "label": "Scratch", "glyph": "file-text",
        "layout": {
          "template": "document",
          "document": {
            "languageId": "sql",
            "read": "/v2/p/board/tasks/:taskId/scratch",
            "write": "/v2/p/board/tasks/:taskId/scratch"
          }
        }
      }]
    }
  }
  ```

  That is the entire job: `read` answers `GET → { text }`, `write` receives `PUT { text }`, and the
  host does the rest — the editor instance, its theme, its workers, the dirty model, the autosave
  debounce, ⌘S, the flush before unmount, and the scroll/cursor position across remounts (keyed by
  node, scope and document, and evicted when a task or workspace is). Omitting `write` is a real mode
  rather than a degenerate one: the surface is read-only, which is what a rendered template or a
  generated migration wants. `languageId` comes from a published vocabulary
  (`@acorn/protocol/languageIds.ts`, LSP's spellings) so an unknown one is a parse error rather than a
  document that silently renders as plain text; the host maps it onto whichever engine draws it. Only
  `:taskId` and `:projectId` are substituted into a route — those are the two values the host holds —
  and both routes are confined to the plugin's own namespace at parse time and again on the device.

  **This exists because the sandbox provably cannot serve it.** A Monaco frame measures 7.93 MiB
  against the 8.00 MiB client-bundle cap with a stub UI, and its language-service workers cannot be
  delivered at all: a plugin origin serves one file and the frame CSP has no `worker-src`. The
  alternative — multi-file plugin origins plus `worker-src` — would be a standing grant to every
  installed plugin, forever, to serve two first-party panes. A host-owned surface widens nothing, and
  costs no plugin a duplicated 7.9 MiB. The bar for any future host-drawn region is that one:
  **common is not the bar; impossible is.** Master/detail is common — every frame already draws its
  own with ordinary CSS — and the host rendering a plugin's list *from data* would mean designing and
  eternally versioning a widget toolkit in the wire format. The answer to that stays no.

  Because a document surface runs no plugin code on the device, it is gated like a **descriptor**
  rather than like a frame: no bytes execute, so there is nothing for a bytes-hash trust prompt to be
  about, and a plugin that ships only document surfaces needs no client bundle at all. The ceiling is
  the honest one — a declarative contract gives a plugin the editor's *features*, not its *API*. No
  decorations, no inline widgets, no arbitrary providers. Capabilities grow only as LSP-shaped
  request/response routes (completions first, when a consumer needs them), never as "run my code
  inside the editor".

  `layout` is region-addressed rather than whole-pane-addressed, and that was decided before there were
  templates to address: a whole-pane declaration would have meant something different once a second
  template arrived, and changing that later would change what already-published manifests mean.
  `frame-beside-document` is the next entry and lands with its consumer, the editor plugin. The design
  record is `docs/future/monaco.md`.

  ### `document-over-frame`

  ```
  ┌──────────────────────────────────┐
  │ host document surface (sql)      │  host: the editor, theme, workers, dirty state, ⌘S, view state
  ├──────────────────────────────────┤  host: the drag handle
  │ [picker] [Save] [Generate] [Run] │  the plugin's frame starts here
  │ results grid                     │
  └──────────────────────────────────┘
  ```

  The host composes this, and the plugin could not: the frame CSP has `frame-src 'none'`, so a plugin
  can never embed host content inside its own layout. That restriction binds the plugin and not the
  host, which is the whole shape of the design — the host places its editor and the plugin's iframe as
  siblings in its own DOM.

  A composed pane runs plugin code in half its rectangle, so unlike the degenerate template it needs an
  accepted bytes hash and a client bundle exactly like any other frame. It is not a cheaper way to run
  untrusted code.

  What is deliberately *not* a region: the button bar. `plugins/database`'s bar holds a searchable
  saved-query picker with per-row delete chips, a Generate button visible only when a model connection
  exists, and an Execute button disabled on connection status. A host-drawn "action bar" descriptor
  sounds cheap until it needs all three. The bar is common, not impossible, so it is the plugin's — the
  first row of its own frame region. Modals are the one honest compromise: a frame confined to the
  bottom region can only overlay the bottom region, and the escape hatch if that grates is the
  `overlay` frame target rather than a widened template.

  **Two regions, no shared realm.** The editor is in the shell and the frame is a sandboxed iframe, so
  everything between them goes through the host, in two directions:

  - **Frame → host: `bridge.document`.** `read()` is the current text including keystrokes the autosave
    has not written yet; `write(text)` goes through the model, so it joins the undo stack and schedules
    the same autosave typing would; `flush()` writes anything pending to the plugin's own write route.
    Three methods, each with a proven consumer. There is deliberately nothing about the EDITOR — no
    cursor, no selection, no decorations — because those are host state or LSP-shaped routes. The verb
    is gated structurally rather than by a declared scope: a frame either has a document beside it or it
    does not, and which one is a fact about the manifest the host already read.
  - **Host → frame: surface actions.** A chord like `⌘Enter` is pressed with focus inside the host's
    editor, where the frame has no keyboard at all. A `commands` entry declares
    `{ "verb": "surfaceAction", "surface": "<pane id>" }` and a `keybindings` entry with
    `when: "surface"` binds the chord. The host resolves it, **flushes the document**, then posts the
    command id over the frame's bridge, where `acorn.onSurfaceAction` receives it. The flush is a
    contract guarantee, not an implementation detail: without it every plugin independently rediscovers
    "it ran the previous version of my query". A frame handles the command exactly as it would its own
    button click, and is not told which gesture produced it.

  ### Language smarts

  A document region may declare `completions: { route, triggerCharacters }`. The host POSTs
  `{ text, position }` (1-based line and column) and renders the `{ label, kind, insertText, detail }`
  items that come back. **The host never learns the language**: context detection is the plugin's, on
  its node half, where the schema knowledge already lives — which is exactly what lets a SQL console, a
  GraphQL console and a YAML config plugin share one host provider with no host change.

  The growth rule this sets as precedent: **capabilities grow as LSP-shaped request/response routes —
  position and text in, standard items out — never as "run my code inside the editor".** Hover and
  diagnostics can follow the same shape when a real consumer needs them. Custom widgets, decorations
  and inline UI cannot, and the test for any proposed addition is "is this an LSP method". The wire
  shapes are `@acorn/protocol/documentSurface.ts`; the kinds are LSP's names rather than its magic
  numbers, because this wire is read by plugin authors and not by an LSP client.
- **Webviews** — a host-drawn pane backed by an Electron-main `WebContentsView`. A surface declares
  exactly one literal `url` or plugin-owned `urlSource` plus a non-empty `hosts` allowlist. HTTPS is
  required except for `localhost`, `127.0.0.1`, and `::1`; the renderer broker validates requested
  navigation and Electron enforces the same list on direct navigation and redirects. The page has an
  isolated ephemeral partition, no preload, no CDP, no devtools, no tunnel credentials, and no script
  or message bridge. The plugin's sandboxed client frame remains the controller for only
  `navigate`, `back`, `forward`, and `reload`; it cannot read the page or type into it.
- **Descriptors** — a rail source, task-footer badge, commands/keybindings, attention items, node stats,
  restricted URL recognizers (`contentLinks`), renderer routes (`routes`), agent-context entries
  (`agentContexts`), and batch reference resolvers (`refResolvers`).
  These are data, not code: the host renders them with its own components and fetches their content
  from routes in the plugin's own `/v2/p/<id>/` namespace, so they stay live when no frame is
  mounted anywhere (`packages/client-core/src/plugins/chrome/`). Freshness rides the existing
  invalidation ping plus one shared timer. A plugin that ships only descriptors needs no client
  bundle at all, and therefore no trust prompt — nothing of its executes on the device. A source may
  declare `createTask`; its row supplies the task seed and optional external link, while the host owns
  the modal, origin namespace, connection ownership check, create-before-link ordering, and
  partial-failure reporting. A source may also declare an `emptyState` — one bounded message and at most
  one context-free action — shown when its route answered with *no items*, in place of the host's fixed
  "Nothing here yet.". Not when the fetch failed: an unreachable node already has its own banner, and
  telling someone "nothing is assigned to you" because a request timed out is a claim the host has no
  business making on a plugin's behalf. It is deliberately no richer than a sentence and a button; the
  field exists because a rail that cannot say what empty *means* pushes sources into showing a wrong
  list instead of an empty one, which is exactly what Linear did. A `contentLinks` entry uses a
  bounded `https://` host/path grammar and delivers one captured path segment to one of **two**
  destinations: an optional **task-scoped** `openPane` from the same manifest, which receives it as a
  `plugin:select` intent in the active task; or the plugin's own **reference panel**, shown over
  whatever the reader was looking at. A link must have at least one of the two, or the manifest is
  rejected — a recogniser that matches URLs and can never open anything looks installed and is not.
  Which destination a click gets is the *clicking surface's* call and not the manifest's, because it
  depends on where the link was: a pull-request conversation asks for the panel so the reader keeps
  their place, a note takes the pane. Either is a preference, and the host falls back to the other
  when it is unavailable. The panel is never *named* — it is addressed by provider, the host stamps
  the plugin id onto every recogniser it registers, and a `refPanel`'s provider must already be the
  plugin itself, so a manifest cannot point a link at another plugin's panel. Likewise a target naming
  anything that is not a registered task pane resolves to nothing rather than pushing an unrenderable
  pane id into a task's persisted layout. A `routes` entry gives a project-scoped surface a URL. Its
  `path` is confined at parse time to the prefix the host mints from the plugin id —
  `/p/:projectId/x/<plugin-id>/` — so it cannot claim core's `/p/:projectId`, `/p/:projectId/new`, or
  another plugin's path, and a collision is a manifest error rather than a race between two loads. It
  names a project-scoped `surface` from the same manifest and one `item` parameter of its own path;
  the host does the matching and supplies the value. A source's `onSelect: { "verb": "navigate",
  "surface": … }` is what changes that URL from a clicked row — the URL is where a project-scoped
  surface's selection lives, because unlike a task pane it has no layout state to keep one in. A
  command may not carry `navigate`, for the same reason it may not carry `createTask`: a command
  registry row has neither a routed project nor the shell's navigator in scope. A slot badge's
  `onClick` takes the same narrowed verb set as a command — `openPane`, `runNodeAction`, `openUrl` —
  for the same reason: its click carries no selected row and no routed project, so a verb that needs
  either would parse and then only ever fail. Only a source's `onSelect` gets the full set, because a
  rail row is the one click site with a row, a project, and the promotion callback in scope.
  `surfaceAction` is the one verb whose effect lands *inside* a plugin rather than on the shell: it
  delivers the command's own id to the frame region of one of that plugin's `document-over-frame` panes
  (§ Document surfaces above), and it may only name a pane the same manifest declares with such a
  layout — a plain frame pane has no document to flush and no host chord to have resolved it. It is
  useful only on a command, because what it delivers *is* the command id, and a footer badge has no
  command in scope. An `agentContexts`
  entry names two routes — `options`
  (GET) and `capture` (POST) — and puts a row in the agent composer's context picker. Its `capture`
  answer is the one descriptor response that ends up inside a model's prompt, so it is parsed against
  a schema rather than sniffed field by field, and the host binds what a plugin must not: `source`
  comes from the plugin id, the capture time is stamped here, and the bytes are measured from the
  content received rather than believed from the response, so the shared 512 KiB
  `MAX_AGENT_CONTEXT_BYTES` ceiling cannot be talked past. An over-budget capture is refused whole,
  never trimmed. The `revision?()` half of the first-party contract has no manifest form on purpose:
  it is synchronous, a descriptor answers across a fetch, and the invalidation ping already covers
  freshness. The whole entry is two routes and a label:

  ```json
  {
    "contributions": {
      "agentContexts": [{
        "id": "http-requests",
        "label": "HTTP requests",
        "description": "Saved requests and their latest responses",
        "options": "/v2/p/http/agent-context/options",
        "capture": "/v2/p/http/agent-context/capture"
      }]
    }
  }
  ```

  `options` answers `GET → [{ id, label, description?, defaultSelected? }]` for the picker; `capture`
  receives `POST { taskId, workspaceId?, optionIds? }` and answers
  `[{ contextId, label, content, resourceId?, provenance?, deepLink?, freshness?, sensitivity? }]`
  (`@acorn/protocol/agentContext.ts` is the schema). Everything else on a snapshot — `source`,
  `capturedAt`, `byteSize`, `estimatedTokens` — is measured and stamped by the host, never read from
  the response.

  A `refResolvers` entry is the same carrier shape for a different question: **what another plugin's
  surface should draw** when it is holding identifiers of this plugin's items. Recognition already has
  an answer — `contentLinks` declares the URL shapes, and the host scans any text for every registered
  recogniser at once (`scanContentRefs`) — so this is only the enrichment half, and it exists because
  the alternative was a cross-plugin import (`github` importing `@acorn/plugin-linear/contract`) that
  cannot survive either side becoming a loaded package.

  ```json
  {
    "contributions": {
      "refResolvers": [{
        "id": "linear-refs",
        "kind": "linear.issue",
        "resolve": "/v2/p/linear/issues"
      }]
    }
  }
  ```

  The host POSTs `{ identifiers }`, count-capped, and parses the answer as
  `[{ identifier, label, state?: { name, color, kind }, url? }]`
  (`@acorn/protocol/refResolvers.ts`). `providerId` is **not** in the body — the host stamps it from
  the plugin whose route answered, the same rule that stops a recogniser claiming another provider,
  because a row that could name its own provider could publish a stranger's items behind a stranger's
  reference panel. A consumer addresses a resolver by provider and never by route
  (`refResolutionsOptions` in `client-core/registries/refResolvers.ts` owns the query key and a
  five-minute staleness for every provider alike), so a surface enriches Linear and a tracker nobody
  has written yet with the same call.

  The response vocabulary is deliberately a label and a state chip, and should stay that way. Every
  field added here is a field *every* provider's answer gets rendered with, which is the descriptor-tier
  slope this tier has declined more than once. The route spends provider credentials on a cache miss,
  and is already behind `requireProviderAccess` through the provider mount — that gate is the
  authorisation, the identifier cap is the budget, and neither replaces the other.

### Frame authoring and the UI kit

A frame owns its document and bundle, so its framework is its choice. The repository package builder
keeps the client Vite transform opt-in per plugin: the plugin's `acorn-plugin.config.mjs` names a
`framework` (`solid` today) that the builder maps to the right transforms, a vanilla frame omits the
key, and adding a framework is one line in the builder's map. A direct `solid-js`
dependency in a Solid frame is intentional. Its separate origin and document are a separate reactive
realm, so this is not the duplicate-Solid-in-one-realm hazard the shell dependency rules prevent.

In-repo Solid frames should import presentation components from `@acorn/plugin-api/ui`, as Rollbar and
Linear do. This workspace dependency is the accepted intermediate package location; the UI kit will be
published separately for external plugins later, and only that import name is expected to change.
Do not copy the primitives or hand-roll replacements while packaging catches up.

Electron main owns the frame document and links `/ui.css`, a stylesheet assembled at build time from
the same presentation-only primitive, tabs, picker, modal, copy, diff, and style-pack CSS the shell
uses. The appearance bridge applies the complete theme/style/invariant token projection to the frame
root. Plugins may add feature-owned CSS for their layout, but they neither bundle nor version a copy
of acorn's UI-kit CSS. Non-Solid frames can use the same emitted class contract without sharing a
JavaScript framework.

Loaded-plugin commands and shortcuts are host-bound manifest data. A command id `search` becomes
`plugin.<plugin-id>.search`; plugin code cannot claim a first-party command id. `palette` controls
whether the command also appears in the palette (default `true`). A keybinding may target only a
command from the same manifest, uses the canonical `meta+ctrl+alt+shift+key` spelling, and must include
`meta`, `ctrl`, or `alt`:

```json
{
  "contributions": {
    "frames": [{ "target": "pane", "id": "editor", "label": "Editor" }],
    "commands": [{
      "id": "search",
      "title": "Editor: find in files",
      "category": "action",
      "palette": true,
      "action": { "verb": "openPane", "pane": "editor" }
    }],
    "keybindings": [{
      "command": "search",
      "defaultChord": "meta+shift+f",
      "when": "surface",
      "surface": "editor"
    }]
  }
}
```

`when` is `global`, `task`, or `surface`; loaded plugins cannot request `typing-exempt`. Command and
binding ids must remain stable across versions because the qualified binding id is the key in the
user's persisted override map. The old `contributions.palette` descriptor remains an alias for a
command with `palette: true` for plugin API v1 and is scheduled for removal in plugin API v2.

The webview manifest shape is:

```json
{
  "target": "webview",
  "id": "docs",
  "label": "Docs",
  "url": "https://docs.example.com/",
  "hosts": ["docs.example.com", "*.example.com"]
}
```

A project-scoped pane needs three entries that refer to each other, and all three are checked when the
manifest is parsed:

```json
{
  "contributions": {
    "frames": [{ "target": "pane", "id": "linear-issue", "label": "Linear issue", "scope": "project" }],
    "routes": [{
      "id": "linear.issue-route",
      "path": "/p/:projectId/x/linear/issues/:identifier",
      "surface": "linear-issue",
      "item": "identifier",
      "order": 60
    }],
    "sources": [{
      "id": "linear-issues",
      "label": "Linear",
      "order": 20,
      "items": "/v2/p/linear/rail-items",
      "onSelect": { "verb": "navigate", "surface": "linear-issue" }
    }]
  }
}
```

What the frame receives is unchanged: `bridge.context.projectId` and, when the URL addresses one,
`bridge.context.item`; every later selection arrives as a `select` message rather than a remount. A
project-scoped surface never gets a `taskId`, which is how a frame that draws both scopes tells them
apart without asking. Its `label` and `glyph` are currently unused — a task pane's label names its
switcher entry, but a project-scoped surface is drawn beside its own rail list, which already carries
the plugin's labels — so do not expect them on screen. The `x` segment is reserved by core for exactly this, and the prefix is derived
from the plugin id alone — a manifest cannot name it.

An `overlay` surface is a full-screen picker — the shape the editor's ⌘P file palette has as a compiled
contribution. The host draws the backdrop, the box, the title and the dismiss affordance; the frame draws
only its contents, because an iframe cannot position itself against anything outside its own rectangle
(the same argument that makes `refPanel` a frame target). It has no click site of its own, so the one
thing that opens it is the `openOverlay` verb, and a manifest declaring an overlay nothing opens is a
parse error rather than a surface nobody can reach:

```json
{
  "contributions": {
    "frames": [{ "target": "overlay", "id": "files", "label": "Go to file" }],
    "commands": [{
      "id": "open-files",
      "title": "Go to file",
      "action": { "verb": "openOverlay", "overlay": "files" }
    }],
    "keybindings": [{ "command": "open-files", "defaultChord": "meta+p", "when": "task" }]
  }
}
```

One overlay is on screen at a time — opening a second replaces the first, because two would leave the
reader unable to tell which one Escape dismissed. Escape and the close button are the host's; the frame
dismisses itself with `acorn.ui.close()` once its picker has picked, which is the one importer verb an
overlay also gets (`done`, the host's post-import refresh, stays importer-only). The overlay is bound to
the task that was active when it opened, so `bridge.context.taskId` is there for a picker whose job is
to put something into one.

A frame surface may also declare the modified chords its own UI handles:

```json
{
  "target": "pane",
  "id": "editor",
  "label": "Editor",
  "claimsKeys": ["meta+f", "meta+shift+f"]
}
```

The frame SDK begins with that declared set and `acorn.keys.claim([...])` may narrow it at runtime.
It cannot add undeclared keys. `meta+k`, `meta+,`, `meta+1`–`meta+9`, and `escape` are never claimable.
All other keydowns are forwarded to the shell's one dispatcher, so global and plugin-surface shortcuts
continue to work while the iframe has focus. Claims are disclosed in the device trust prompt and in
Settings → Shortcuts.

`urlSource` replaces `url` when the start URL is dynamic and must be inside the plugin's own
`/v2/p/<id>/` namespace; it answers `{ "url": "..." }` and receives task/project ids as query
parameters when present.

When a plugin has a client bundle, frames, webviews, and descriptors are gated on trust, per device and per
bundle: first sight of a `(plugin, hash)` pair prompts before anything registers, an update re-prompts
with the permission diff, and a rejected bundle gets neither frames nor chrome. A descriptor-only
plugin has no client bytes to trust and registers its data directly. The prompt renders the node-half
permissions, enforced UI scopes and key claims, and webview host grants as **three separate lists**. Webview hosts are
enforced but the remote page has live network access, so folding them into the networkless UI list
would be misleading. For the original two groups, only the second is enforced —
`packages/client-core/src/plugins/permissions.ts` explains why they must never be merged, and it
classifies every line against what the host can actually grant rather than echoing manifest text.

Two behaviours that surprise authors, both deliberate: the `footer` slot is the **task** footer
(the slot `docker-footer-badge` occupies), so a badge is invisible until a task has a worktree; and
across a fleet exactly one bundle per plugin id is active — highest version at this plugin-API
major, chosen at boot and stable for the session — because contribution ids are un-namespaced
persisted layout keys and two versions registering at once would collide on them.

Client initialization for compiled-in plugins is synchronous registration. The host exposes contribution points for panes,
sources, settings pages, shell/task slots, context sections, provider reference panels, palette rows,
agent contexts, agent-tool renderers, pollers, persisted-state slices, Node statistics, and attention
items. An activation pass handles subscriptions or local storage initialization after all descriptors
exist.

**`persistedState` has no manifest form, and will not get one.** A slice is not a value — it is a
`{ codec, empty, unknownIds, maxBytes, legacy, binding: { values, hydrate } }` record the host drives
through its own restore phases, reading and writing SHELL SIGNALS at boot before any frame exists, and
clearing them on scope eviction. None of that survives a port: a descriptor cannot hand over a codec, and
a frame is not mounted at the moment the phase it would belong to runs. A loaded plugin's answer is the
frame's `state.get`/`state.set` verbs into its own `plugin:<id>:*` namespace, which are the same prefs
the Node half's `prefs` facet reads — durable, per-node, capped at 1 MiB, and shared between a plugin's
two halves. What it costs is the orchestration: the frame reads its own state when it mounts instead of
being hydrated before first paint, and it clears its own keys instead of the host doing it on eviction.
That is a real difference and the reason the editor's open-file tabs cannot simply move as they are.

A source may also contribute routes. Two rules keep that seam honest. A route ADDRESSES an item inside a
surface — it must never gate whether the surface renders, because the rail selects a source by signal and
never navigates, so a render gated on a route match is unreachable. And a source scopes itself to the routed
project, rendering at core's `/p/:projectId` alongside every other source; its own paths hang below that
(`/p/:projectId/pulls/:number`, `/p/:projectId/issues/:identifier`). Core's URLs are constants in
client-core, not registry lookups, so a contributed route can never be resolved in core's place. The one
question core asks back is `SourceContribution.taskPath`: where a task the source owns should live.

## Collaboration rules

Plugins collaborate through four mechanisms:

1. **Contracts** — import only a provider's `contract/` entrypoint for types, capability IDs, or
   narrow pure functions.
2. **Capabilities** — resolve typed functions from the Node's per-runtime capability registry at
   call time. This is the Node's only late-binding mechanism: route handlers receive a read-only
   capability view through `RuntimeBindings`, while plugin providers register during `init`. Missing
   optional providers produce a degraded feature, not a module import. The small helpers in
   `server/bridge.ts` are typed route adapters; their setter functions exist only for isolated route
   tests and are never used by production composition.
3. **Broadcasts** (`ctx.events`) — tell connected CLIENTS that something changed. This is not a
   plugin-to-plugin channel and there is no subscribe side: nothing in the node listens. It is an
   invalidation channel over the authenticated WebSocket — no durability, no replay, no delivery
   guarantee — and a client that misses one refetches after the gap. Durable history belongs in the
   owning plugin's tables. Two plugins that need to talk use a capability (2).
4. **Client registries and slots** — register UI contributions without importing another plugin's
   implementation. The host records disposables so disabling/reloading a plugin removes its entries.

The architecture test enforces zero non-contract plugin-to-plugin edges, no app imports from packages
or plugins, no Electron imports outside the allowed desktop surface, protocol purity, declared
dependencies, an acyclic package graph, and the client/Node split.

## Data ownership

Table-owning plugins open one `plugins/<name>.sqlite` file under the Node data root and own its
migrations. Current table-owning plugins include agents, changes, database, GitHub, HTTP, memory,
notes, terminal, and workflows. Core owns shared workspace/task/integration/external-item/security
tables. Docker, editor, Linear, Rollbar, model providers, preview, and the built-in agents profiles
use core services or provider registries without owning a database file.

A loaded plugin that owns tables declares a package-relative `migrations` directory in
`acorn-plugin.json` and calls `ctx.storage.open()`. The loader confines and validates that chain,
while the host binds the SQLite filename to the manifest id. No declaration means no storage; there
is no fallback search outside the package.

HTTP is the only plugin on that path, and it is what makes the rest of this paragraph real rather than
designed: `build-plugin.mjs` stages the declared directory into the package it builds — a chain that
travels with the code, since Drizzle reads the journal and the `.sql` files off disk at migrate time —
and `apps/node/test/integration/httpLoaded.test.ts` covers a schema change arriving through an
installer update against a populated database, a broken chain failing contained, and
uninstall-without-purge keeping the file. Because the filename is bound from the manifest id, that id
is the one thing in a table-owning package that can never change: renaming it orphans real rows.

There are no cross-file foreign keys, `ATTACH` queries, or transactions spanning plugin databases.
Cross-plugin workflows use durable operation state and explicit IDs/capabilities.

## Tool projection

A plugin registers schema-validated agent tools with risk metadata. Core projects the registry into:

- the task-scoped HTTP tool surface;
- the stdio MCP server used by spawned agents;
- renderer permission and tool-description UI.

The caller's internal-token scope and the owner's tool permission settings are both applied. Tool
implementations run in the Node and use CoreServices; the renderer and MCP process do not open plugin
databases directly.

## Adding a plugin contribution

1. Put the behavior in the owning plugin and choose the correct runtime directory.
2. Use CoreServices rather than importing core implementation modules or another plugin's internals.
3. Add a narrow `contract/` export, capability, or client registry entry when collaboration is
   needed; `ctx.events` if the renderer needs telling.
4. Register the Node/client entry in the appropriate composition list.
5. Add package-local tests and, for rendered behavior, desktop e2e coverage.
6. Run the architecture test, `pnpm lint`, and the relevant tests.
