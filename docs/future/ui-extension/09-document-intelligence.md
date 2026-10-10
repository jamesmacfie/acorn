# Phase 09: add document hover and diagnostics

Status: done, October 10, 2026. Branch `phase-09-document-intelligence`, from `d1a732fbb`.

## Completion note

Plugins can answer hover and diagnostics through their own Node routes. A document region names its
routes, and Editor's files get a provider by language. The host sends the live buffer, checks every
answer against the revision and the text it sent, and draws the result. No provider code runs in the
editor, and completion and saving work as they did.

### What landed

- **Protocol.** `documentSurface.ts` has `PluginPosition`, `PluginRange`, the hover and diagnostics
  request and response types, `DIAGNOSTIC_SEVERITIES`, `MAX_HOVER_BYTES` (64 KiB),
  `MAX_DIAGNOSTICS` (200), and `MAX_LANGUAGE_REQUEST_BYTES` (1 MiB). A `document` region takes
  `hover` and `diagnostics`, each `{ route }`. `contributions.documentServices` takes
  `{ id, label, languageId, hover?, diagnostics? }`, up to eight, and needs at least one service.
  The generated `acorn-plugin.schema.json` follows.
- **Node.** The manifest check confines all four new routes to the plugin's namespace and counts
  `documentServices` ids with the other contributions. The `plugin_authoring` brief has a paragraph
  on both declarations, both bodies, the coordinates, and the caps.
- **Client registry.** `host/registries/panes/documentServices.ts` owns the provider registry,
  `resolveDocumentServices`, the reply checks (`checkHover`, `checkDiagnostics`), `positionAt`, the
  1 MiB check, and `requestHover` and `requestDiagnostics`. `chromeRegister.ts` registers each
  provider from the roster row after rechecking the language and route ownership. `layouts.ts`
  rechecks a region's routes.
- **Choosing a provider.** One provider for a language and service serves on its own. On a tie,
  neither runs until the person picks under **Settings > Advanced > Extension points > Language
  services**. The pick is the Node preference `document_services`, in the `remote_slots` shape. A
  pick for a plugin that's gone means no provider, never the runner-up. Only plugins running on the
  viewed Node count.
- **Desktop.** `features/editor/languageServices.ts` is one CodeMirror extension: a `hoverTooltip`
  and a view plugin that asks for diagnostics at once and 500 ms after the last edit, through
  `@codemirror/lint`. It aborts the prior read on an edit, a new file, or `refreshLanguageServices`.
  `DocumentSurface.tsx` uses it with the region's own routes. `EditorPane.tsx` adds it to each file's
  state with the resolved provider and refreshes the shown file when the provider changes. Both show
  the 1 MiB reason as a muted line.
- **Terminal.** The document region draws **Inspect position**, which asks about the caret, and
  **Diagnostics**. The terminal field exposes a read-only `cursor` for this. Editor draws a
  **Diagnostics** button, `FileDiagnostics.tsx`, that checks the file as saved.
- **Consumers.** Database declares `hover` on its scratch region. `server/hover.ts` describes a table's
  columns or a column's type from the completion catalog. The loaded fixture
  `apps/node/test/__fixtures__/json-diagnostics` reports `JSON.parse` errors for Editor's JSON files.
- **Docs.** [Hover and diagnostics](../../editor/document-surface.md#hover-and-diagnostics) owns the
  contract. The contribution-kinds table, the manifest rules, and document surfaces point to it.

### Decisions and deviations

- **A region uses only its own routes.** File-language providers never see a document region, even
  for a language and service the region doesn't declare. That's the simplest reading of "explicit
  owner precedence", and it means a database scratch can't reach another plugin's SQL provider.
- **The owner fallback is no provider.** Editor has no hover or diagnostics of its own, so a tie or a
  missing pick draws nothing. This is `resolveSlot`'s rule, not a registration-order winner.
- **Columns count UTF-16 units,** as completion positions already did, because that's an editor
  offset. An emoji is two columns.
- **What gets dropped.** A hover is dropped for another revision, an edit while it was in flight,
  empty or oversized contents, or a range outside the text. A diagnostics answer for another revision
  or with no list clears the marks. Single items with a bad range, severity, or message are dropped
  one by one. Messages are cut at 2,000 characters, and `code` and `source` at 100.
- **Credit is the host's.** A hover shows **From** with the provider's label. A diagnostic's source
  reads `<label> · <source> · <code>`, so a provider can't pass its marks off as another tool's.
- **A hover route may answer `null`** for a position with nothing to say. Database does that off a
  known name and before it has connected.
- **`@codemirror/lint` is a direct dependency of client-core and the terminal.** It was already
  installed and loaded through `codemirror`'s `basicSetup`, so the lockfile gained two specifiers and
  the desktop payload nothing. The terminal lists it because its build carries the desktop document
  surface as a lazy chunk, and its runtime-import check refused the unlisted package.
- **The fixture reads V8's message for a position.** "Unexpected token" errors give no position, only
  quoted context that starts 10 characters before the token, so the fixture uses that.
- **Registration replacement** with identical routes doesn't re-ask the shown file. A provider that
  appears, goes, or is picked does. Plugin reloads change availability, which covers the real case.
- **The terminal Editor has no Inspect position.** It has no buffer or cursor, because the person
  edits in `$EDITOR`. Its Diagnostics check the saved file, so a fix shows after saving there.

### Verification

Run with Node 26.8.1.

- `documentServices.test.ts` (9): one provider, a tie with no pick, a pick, a pick that's gone, a
  pick for the other service, Node scoping, one-based UTF-16 positions with an emoji, the 1 MiB cap
  in UTF-8, and hover and diagnostics checks for revision, bounds, shape, and size.
- `languageServices.test.tsx` (8), a real CodeMirror view: the request body, the drawn hover and its
  credit, stale, out-of-bounds, and late answers, inert Markdown (no image, script, or `javascript:`
  link), the 1 MiB reason, marks at once and again after exactly 500 ms, and clearing on an empty,
  failed, or stale answer and when the provider goes. Removing the hover's revision check fails a test.
- `DocumentSurface.test.tsx`: two SQL documents each send only to their own route and get only their
  own marks, while completion and saving still work. `layouts.test.ts`, `chromeRegister.test.ts`, and
  `ExtensionPointsDev.test.tsx` cover the client recheck, registration, and the picker.
- `EditorPane.test.tsx`: an unsaved JSON buffer is marked and clears once fixed, with the file on disk
  untouched. A tie asks nobody until the Node pick, the other provider serves alone once the pick goes,
  and the marks clear once none is left. `FileDiagnostics.test.tsx` covers the terminal button.
- `apps/tui/src/plugins/DocumentSurface.test.tsx`: clicking **Diagnostics** and **Inspect position**
  in cells asks the region's own routes about the live buffer, and a wrong revision isn't drawn.
- `manifest.test.ts`, `pluginAuthoring.test.ts`, `database.test.ts` (hover route), and
  `apps/node/test/integration/plugins/documentServices.test.ts`, which loads the fixture from a copied
  folder and checks its manifest and answers.
- Suites: `@acorn/protocol` (299), `@acorn/node-core` (1,760), `@acorn/client-core` (2,697),
  `@acorn/plugin-database` (113), and `acorn-plugin-types` pass. `@acorn/plugin-api` passes with the
  updated surface snapshot. `@acorn/plugin-editor` fails only the four known status-menu tests,
  `@acorn/tui` only the two `chrome.test.tsx` marker tests, and `@acorn/node` only the nine known
  tests. The route golden differs only by the known workflows invocation route. `@acorn/arch-tests`
  fails only the 15 known dead links. Lint errors are only in the known agents, changes, git, and
  workflows files, and oxlint flags nothing new. The service budget reads 1,757,365 of 1,759,000 B,
  and the terminal startup closure 686,244 of 700,000 B.
- **Desktop, `pnpm dev:agent --fixture tui-navigation`,** with `DATABASE_URL` set to a scratch
  Postgres and the fixture installed from a copied folder. Editor underlined the `]` of a trailing
  comma in `broken.json`, and the lint panel read the message with "JSON syntax · JSON.parse". A
  one-character break drew the mark about 860 ms after the edit. A fix that kept the `]` in place
  left the mark there 100 ms later, and it was gone by 1.3 s. In the Database pane, a synthetic hover
  over `orders` drew "orders, 3 columns" with each column's type, and over `o.total` drew "`total`
  numeric · orders", both "From Database". The hidden window needed `document.hidden` overridden.
- **Terminal, `pnpm dev:tui:agent --fixture tui-navigation`,** with the fixture installed. Editor
  drew **Diagnostics** under `broken.json`, so the provider registered and resolved in that host. The
  driver couldn't press it: Tab leaves the pane for the rail. The cells tests above press it. This
  session offered no Database pane, so terminal SQL hover rests on the cells test.

### What later phases need to know

- An owner adds `languageServices({ nodeId, routes, revision })` (`@acorn/plugin-api/ui/editor`) to
  its editor state and dispatches `refreshLanguageServices` when its routes change. An owner that draws
  its own uses the request helpers on `@acorn/plugin-api/client`. The testkit exports the registry.
- `document_services` is a Node preference, so a Node switch picks again. `remote_slots` stays the
  device's.

## Original plan

Planned October 6, 2026. Baseline: `0ce874a15c856db07992cc5f7650b6730c6aadaf`.
Depends on phase 08. Follow the document contract's typed language-service growth rule.

Let plugins supply language hover and diagnostics through confined Node routes. The host draws their
results and owns editor state. Do not expose editor vendor extensions or arbitrary inline widgets.

## Starting point and owners

`packages/protocol/src/content/documentSurface.ts` defines completion requests with one-based
`{ line, column }` positions. `packages/client-core/src/features/editor/DocumentSurface.tsx` maps
declared completion routes onto the host editor. `apps/tui/src/plugins/DocumentSurface.tsx` supplies
the terminal projection. `plugins/database/src/server/completions.ts` is a real route-backed consumer.
`plugins/editor/src/client/EditorPane.tsx` owns file documents and their language identity.

Read [language smarts](../../editor/document-surface.md#language-smarts),
[document surfaces](../../plugins/document-surfaces.md), and [the manifest](../../plugin-authoring/the-manifest.md).

## Contract

Add optional `hover: { route }` and `diagnostics: { route }` to document region declarations.
Routes belong to the declaring plugin. An explicit document-region route wins over file-language
providers, so a database scratch document never receives another plugin's SQL results accidentally.

For file Editor consumers, add `contributions.documentServices` descriptors with
`{ id, label, languageId, hover?, diagnostics? }`. Each optional service names an own-plugin route;
at least one is required. Validate language IDs and ownership at Node parse and client arrival.
Select one provider per language and service on the viewed Node, with a settings choice and owner
fallback on ties or unavailable choices. Reuse arbitration semantics, not a registration-order winner.

Hover receives `{ text, position, revision }` and returns `{ revision, contents, range? }`.
Contents are bounded `{ kind: 'plaintext' | 'markdown', value }`, at most 64 KiB, rendered sanitized.
Diagnostics receives `{ text, revision }` and returns `{ revision, items }`, at most 200 items.
Each item has a one-based range with exclusive end, severity, message, and optional string code/source.
These are a documented subset of language-server vocabulary with Acorn's completion coordinate convention.
Do not claim byte-for-byte LSP compatibility or change completion coordinates in this phase.

Use the live buffer. Cap requests at 1 MiB UTF-8 and show an unavailable reason for larger documents.
No absolute path or file grant is implicit. Provider data may use its own declared Node capabilities.
Reject stale revisions and invalid/out-of-bounds ranges before drawing.

## Steps

1. Add protocol types, optional descriptor fields, file-service declarations, route confinement,
   schemas, discovery, and per-Node provider settings. Preserve completion declarations unchanged.
2. Add document-owner adapters for hover requests and a 500 ms diagnostics debounce after changes.
   Abort prior reads on buffer, scope, provider, or registration changes. Empty/failing results clear
   that provider's UI, without disturbing completion, saving, selection, or other owner marks.
3. Draw bounded host tooltips and diagnostic markers/list entries. Terminal offers explicit Inspect
   position and Diagnostics commands, using the same routes and coordinates; no hover pointer is assumed.
4. Add database schema hover through its document declaration, reusing its schema readers. Add a
   loaded JSON syntax diagnostic provider fixture for file Editor, demonstrating the language registry.
5. Keep diagnostics read-only. Do not add fixes, commands embedded in Markdown, CodeMirror imports
   into providers, a language-server process manager, or network access to the client worker.

## Tests and acceptance

Extend DocumentSurface tests, Editor tests, protocol/manifest route tests, database route tests, and
terminal document tests. Cover provider ties, explicit owner precedence, one-based positions, Unicode,
unsaved text, oversized requests, invalid ranges, malicious Markdown, errors, and stale revisions.
Prove two SQL document owners do not share provider state and completion/saving remain unchanged.

Run `pnpm lint`, full suites for `@acorn/protocol`, `@acorn/node-core`, `@acorn/client-core`,
`@acorn/plugin-editor`, `@acorn/plugin-database`, `@acorn/tui`, declaration packages, and architecture.
Expect exit zero. Check SQL hover and a live JSON error in both hosts; fix the JSON and confirm clearing.

Complete when both owned-region and file-language routes work with bounded, revision-safe results,
and no provider code runs inside the editor.

## Verify before building

- Recheck the shipped document capability schema and completion coordinate conventions.
- Recheck file language identity after Editor viewer work and the provider-choice settings precedent.
- Stop if the solution needs an editor-specific API or an undeclared universal language-server runtime.
