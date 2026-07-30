# Renderer capability negotiation

Status: Normative<br>
Requirement prefix: `UI-CAP`

Renderer capabilities let a Node describe semantic UI without assuming Electron implementation
libraries. Negotiation occurs at Node handshake and again when opening a view.

## Capability descriptor

Each Electron client advertises:

`id`, `version`, `features`, `limits`, `platform`, `inputModes`, `accessibilityFeatures`,
`localeCapabilities`, and `securityProfile`.

The complete V2 negotiated family registry is `acorn.layout/2`, `acorn.content/2`,
`acorn.form/2`, `acorn.wizard/2`, `acorn.collection/2`, `acorn.code-editor/2`,
`acorn.file-tree/2`, `acorn.search-results/2`, `acorn.diff-review/2`,
`acorn.terminal/2`, `acorn.log/2`, `acorn.agent-timeline/2`,
`acorn.markdown/2`, `acorn.media/2`, `acorn.browser-preview/2`, and
`acorn.bespoke-sandbox/2`. There are no aliases. In particular,
`acorn.data-grid`, `acorn.resource-tree`, leaf node IDs and feature names are
not negotiated families.

Examples include `acorn.layout`, `acorn.form`, `acorn.collection`, `acorn.file-tree`,
`acorn.code-editor`, `acorn.diff-review`, `acorn.terminal`, `acorn.agent-timeline`,
`acorn.markdown`, `acorn.media`, `acorn.browser-preview`, `acorn.bespoke-sandbox`.

- **UI-CAP-001:** Capabilities describe semantics and hard limits. They MUST NOT disclose library
  versions, executable paths, browser profile details or host security secrets.
- **UI-CAP-002:** Negotiation selects one compatible major and highest compatible minor for each
  required capability. The selection is fixed for a view session.
- **UI-CAP-003:** An unknown required capability makes the contribution unavailable with its signed
  fallback/unsupported state. Unknown optional capability is omitted.
- **UI-CAP-004:** A plugin cannot infer permission from renderer support. `acorn.terminal` means
  Electron can render a terminal stream, not that the plugin may create or write one.
- **UI-CAP-004A:** A contribution declares negotiated family requirements in
  its `requires.rendererCapabilities` and leaf node kinds in
  `requires.rendererNodes`. Semantic activation rejects an unknown family
  major, a leaf advertised as a family, or a node not owned by every negotiated
  family in the canonical table in `renderers/README.md`.

## Standard feature flags

| Capability | Negotiated features |
| --- | --- |
| `acorn.code-editor` | read/edit, multi-file, diagnostics, selection, reveal, language IDs |
| `acorn.diff-review` | unified/split, virtualized, comments, suggestions, binary summary |
| `acorn.terminal` | stream protocol, resize, input, search, link intents, accessibility mode |
| `acorn.collection` | list/tree/table/data-grid/detail, sort/filter/page, virtual rows, selection |
| `acorn.agent-timeline` | transcript, tool events, approvals, streaming, usage |
| `acorn.browser-preview` | native view, navigation, bounds, capture policy, fallback |
| `acorn.bespoke-sandbox` | bridge major, CSP profile, storage/network policies |

- **UI-CAP-005:** Limits MUST include document/patch bytes, rows, columns, text length, open editors,
  terminal cells/backlog, media bytes and stream bandwidth where relevant.
- **UI-CAP-006:** Node generates within the lower of client, manifest, grant and policy limits.
  Electron revalidates and may refuse an oversized document.
- **UI-CAP-007:** Capability changes after Electron update close and reopen only affected sessions
  after preserving compatible presentation state.

## Fallback

- **UI-CAP-008:** Fallback order is same contribution using a lower compatible capability, declared
  semantic fallback, explicit unsupported surface. Substituting bespoke UI without declaration and
  verification is invalid.
- **UI-CAP-009:** Unsupported surfaces state missing capability, affected operation, whether Node
  behavior continues, and available actions such as update client, open raw data, use desktop or
  copy resource link.
- **UI-CAP-010:** Future mobile mapping may expose smaller subsets and size classes. Desktop-only
  status cannot cause Node plugin deactivation.

## Provider activation

- **UI-CAP-012:** A renderer capability implementation belongs to the Electron Client build and is
  recorded in a signed local allowlist. A remote Node advertises only semantic requirements and
  artifact digests; it cannot supply the implementation or executable code.
- **UI-CAP-013:** A System or Acorn Verified `renderer-provider` contribution activates one
  allowlisted implementation after exact renderer-major, implementation-ID, Client-version,
  feature, accessibility and local artifact checks. No match produces the ordinary unsupported
  renderer state.
- **UI-CAP-014:** Editor activates the built-in code editor, file tree, search results and diff
  review implementations. Preview activates the built-in Electron native browser view. Monaco,
  diff virtualization and `WebContentsView` remain replaceable Client implementation details.

## Acceptance

- **UI-CAP-011:** A capability matrix test MUST open every standard renderer at minimum and current
  minor, omit each required and optional capability, lower every limit, update capabilities during a
  session and verify deterministic fallback.
