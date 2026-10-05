# Deferred and refused UI extensions

Status: design decisions, October 6, 2026. No implementation in this programme has shipped.

This page records boundaries for the [UI extension programme](./README.md) and when to revisit them.

## Reimplementing supported contributions

Panes, sources, settings, overlays, commands, shell replacements, composer controls, tool cards,
task annotations, and rail context menus already have owner contracts. Extend them where required.
Do not introduce a parallel registration API for the same job.

## Another generated-report system

Interactive reports belong to [agent-built Apps](../dynamic-ui/README.md). Static file reports use
Editor viewers. A single-source table or chart can use a dashboard panel. No phase here builds app
tools, app revisions, project promotion, or app trust.

## Dynamic App contribution points in the first cut

The user asked on October 6, 2026, to keep plugin hooks for dynamic UIs open for a possible follow-up,
while probably omitting them from the first cut. Preserve that scope.

A later Apps host can reserve an outer companion region. It would bind app identity, revision,
placement, and task/project scope and mount contributors with their own permissions. Essential app
controls, immutable revision history, and archived-app behavior remain owned by Apps.
Phase 06's outer-region design must not assume every loaded owner is an app or widen the app profile.

Regions inside generated content need an explicit declaration and a separate host-controlled mounting
design. Revisit after the dynamic UI spike resolves tree hosting and a concrete app needs the region.
Do not add placeholder app points, grant arbitrary capabilities, or allow generated code into chrome.

## Arbitrary nested remote slots

Ordinary remote trees cannot open cooperative slots. The chrome `slotRef` exception does not generalize
to generated apps or loaded detail views. Keep one-level composition. Host wrapper regions are enough
for phase 06. A stronger requirement needs its own protocol and trust review.

## External websites inside plugin frames

Plugin frames cannot nest arbitrary external pages under the shipped content security policy.
URL previews use remote kit UI. Browsing remains a deliberate host native-webview action.
Do not weaken `frame-src` or `connect-src` to make a preview work.

## Generic URL fetching by core

Core opens and hosts previews; providers fetch their own data on the Node with declared access.
No universal scraper, authentication broker, or arbitrary network permission belongs in core.
Provider-specific fetching checks URLs, redirects, sizes, and timeouts at its own boundary.

## Editor vendor extensions and arbitrary selection capture

Language services use typed routes. File renderers do not receive CodeMirror objects, DOM references,
selection observers, or workspace filesystem grants. Selection actions start in an explicit host
command or menu and capture content only from supported owner adapters.

## More file viewer formats in this programme

Editor viewers are a prerequisite. PDF, media streaming, rectangle replacement, and side-by-side
rendering follow [that proposal](../editor-files.md). Do not make them hidden prerequisites of URL
previews or transcript viewer points. The byte bridge's limit remains explicit.

## Verify before building

- Read the [dynamic UI profile](../dynamic-ui/design.md#what-an-app-can-reach).
- Read [the client sandbox](../../security/plugin-client-sandbox.md) before changing isolation.
- Confirm any proposed exception has a real caller and changes an owning contract deliberately.
