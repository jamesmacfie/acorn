# Standard renderer catalog

Status: Normative<br>
Requirement prefix: `UI-RENDER`

Standard renderers let plugins express meaningful Acorn UI without shipping client code. Electron
owns their implementation, security, accessibility, theme/style integration and performance.

## Catalog

The first column is the exhaustive negotiated family registry. The second
column is the exhaustive UI-document leaf registry. A leaf is never advertised
in the handshake and a family is never used as a document node. Host-owned
confirmation is an action ceremony, not a renderer. Agent Center is composed
from collection/content/agent-timeline; Markdown editing uses code-editor with
the `markdown` language plus markdown preview.

| Negotiated capability | UI-document renderer identifiers | Detail |
| --- | --- | --- |
| `acorn.layout/2` | `acorn.stack/1`, `acorn.row/1`, `acorn.grid/1`, `acorn.split/1`, `acorn.section/1`, `acorn.tabs/1`, `acorn.disclosure/1`, `acorn.toolbar/1`, `acorn.scroll/1`, `acorn.separator/1` | [primitives and layout](./primitives-and-layout.md) |
| `acorn.content/2` | `acorn.text/1`, `acorn.heading/1`, `acorn.icon/1`, `acorn.badge/1`, `acorn.status/1`, `acorn.callout/1`, `acorn.code/1`, `acorn.key-value/1`, `acorn.link-intent/1` | [primitives and layout](./primitives-and-layout.md) |
| `acorn.form/2` | `acorn.form/2` and closed field kinds | [forms, settings and wizards](./forms-settings-and-wizards.md) |
| `acorn.wizard/2` | `acorn.wizard/2` and standard setup steps | [forms, settings and wizards](./forms-settings-and-wizards.md) |
| `acorn.collection/2` | `acorn.list/2`, `acorn.virtual-list/2`, `acorn.tree/2`, `acorn.table/2`, `acorn.data-grid/2`, `acorn.detail/2` | [lists, trees, tables and detail](./lists-trees-tables-and-detail.md) |
| `acorn.code-editor/2` | `acorn.code-editor/2` | [editor, files, search and diff](./editor-files-search-and-diff.md) |
| `acorn.file-tree/2` | `acorn.file-tree/2` | [editor, files, search and diff](./editor-files-search-and-diff.md) |
| `acorn.search-results/2` | `acorn.search-results/2` | [editor, files, search and diff](./editor-files-search-and-diff.md) |
| `acorn.diff-review/2` | `acorn.diff-review/2` | [editor, files, search and diff](./editor-files-search-and-diff.md) |
| `acorn.terminal/2` | `acorn.terminal/2` | [terminal, agent, log and timeline](./terminal-agent-log-and-timeline.md) |
| `acorn.log/2` | `acorn.log/2` | [terminal, agent, log and timeline](./terminal-agent-log-and-timeline.md) |
| `acorn.agent-timeline/2` | `acorn.agent-timeline/2` | [terminal, agent, log and timeline](./terminal-agent-log-and-timeline.md) |
| `acorn.markdown/2` | `acorn.markdown/2` | [Markdown, media, preview and browser](./markdown-media-preview-and-browser.md) |
| `acorn.media/2` | `acorn.media/2` | [Markdown, media, preview and browser](./markdown-media-preview-and-browser.md) |
| `acorn.browser-preview/2` | `acorn.browser-preview/2` | [Markdown, media, preview and browser](./markdown-media-preview-and-browser.md) |

- **UI-RENDER-001:** Component kind is a closed name within a negotiated capability major. Unknown
  kinds invalidate the affected subtree and select the declared fallback.
- **UI-RENDER-002:** Every property has a fixed type, bound, default, accessibility meaning and
  patchability. Arbitrary property bags and host class/style injection are invalid.
- **UI-RENDER-003:** Renderers accept untrusted values. They encode text, sanitize supported media,
  validate resource/navigation targets and never convert data into executable markup.
- **UI-RENDER-004:** Every interactive renderer emits only documented semantic user events with
  bounded typed payloads. DOM events and browser objects never cross the view boundary.
- **UI-RENDER-005:** Every renderer supports loading, empty, stale, offline, denied, unsupported and
  error host states either intrinsically or via the common state wrapper.
- **UI-RENDER-006:** Standard actions are `invoke`, `navigate`, `select`, `edit`, `commit`, `reset`,
  `page`, `sort`, `filter`, `expand`, `resize`, `focus`, and `copy-intent`. The action target is a
  declared action ID, not executable code.

## Common properties

All component nodes have `id`, `kind`, optional `accessibleName`, `description`, `visibility`,
`enabled`, `busy`, `tone`, `density`, `testTag`, `children`, and optional action bindings.

- **UI-RENDER-007:** `visibility` is `visible`, `hidden`, or `collapsed`; hidden content is not
  accessible or focusable. It cannot hide mandatory host warnings.
- **UI-RENDER-008:** `tone` is semantic: `neutral`, `accent`, `success`, `warning`, `danger`,
  `info`, or `muted`. Renderers preserve non-color indicators.
- **UI-RENDER-009:** `testTag` is namespaced inert metadata available only in development and
  conformance hosts; it is absent from analytics and authority decisions.
- **UI-RENDER-010:** Unknown enum values use the capability's defined safe fallback or make the
  component unsupported; they MUST NOT silently acquire a stronger action or tone.

## Geometry and performance

- **UI-RENDER-011:** The host controls actual CSS, fonts, z-index, scroll containers, portals,
  virtualization, canvas/WebGL use and native views.
- **UI-RENDER-012:** Plugins provide semantic sizing (`content`, `fill`, bounded weight, documented
  minimum) rather than pixels except renderer contracts that require measured rows/cells.
- **UI-RENDER-013:** Virtualized components use stable item IDs and estimates supplied by the host.
  Plugin patches cannot alter measured geometry in a way that bypasses remeasurement.
- **UI-RENDER-014:** A component cannot mount timers, observers or native resources. The host
  creates only those needed by visible negotiated renderers and releases them on suspension.

## Conformance

- **UI-RENDER-015:** Each renderer capability MUST publish a fixture matrix covering every
  component/property/event/state, min/max bounds, malicious content, keyboard/screen reader,
  compact/medium/expanded layout, theme/style combinations and document/patch updates.
- **UI-RENDER-016:** Manifest semantic validation uses this table as a closed
  registry. It rejects `acorn.resource-tree`, `acorn.data-grid` as a family,
  `acorn.confirmation`, `acorn.markdown-editor`, `acorn.agent-center`,
  `acorn.log-stream`, a leaf/family role swap and every unknown major.
