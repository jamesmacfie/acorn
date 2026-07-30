# UI contribution model

Status: Normative<br>
Requirement prefix: `UI-CONTRIB`

Electron is the V2 client and UI host. Plugins extend Acorn with signed contributions whose
presentation is either semantic (host-rendered) or bespoke (isolated guest-rendered). A remote Node
never supplies JavaScript to Electron.

## Host model

- **UI-CONTRIB-001:** Electron owns the Fleet shell, routing, navigation, layout, focus,
  accessibility, themes/styles, notifications, prompts, permission UI, settings host, wizard host,
  renderer implementations, view-session client, bespoke guest host and native capabilities.
- **UI-CONTRIB-002:** A Node owns authoritative product state, plugin activation, settings/setup
  state, view-session server, query/command/event authorization and durable jobs.
- **UI-CONTRIB-003:** A plugin contributes only the signed metadata cataloged in
  [contribution catalog](../plugins/contribution-catalog.md), semantic UI documents, validated
  patches and separately signed bespoke artifacts.
- **UI-CONTRIB-004:** An active contribution receives no DOM, SolidJS, Electron, Node.js,
  `webContents`, preload function, cookie, database, filesystem or network object.
- **UI-CONTRIB-005:** The host MUST place an error boundary around every contribution. Failure is
  attributed to installation/generation/contribution and cannot remove the shell or sibling
  contributions.

## Semantic contributions

The Node opens a view session for a contribution, executes only its declared data sources, and
returns a `ui-document-v2` document. Electron selects standard renderers based on negotiated
capabilities.

- **UI-CONTRIB-006:** Semantic documents contain only typed components, properties, bindings,
  actions, resources and localization keys. Raw HTML, JavaScript, SVG markup, CSS, class names,
  event handlers, arbitrary URLs and ambient data queries are invalid.
- **UI-CONTRIB-007:** All text is treated as text unless a specific renderer accepts a sanitized
  media type. Plugin input cannot select `innerHTML`, Electron navigation or a preload bridge.
- **UI-CONTRIB-008:** Every semantic contribution MUST declare loading, empty, error,
  permission-denied, unsupported-renderer, stale and offline behavior.
- **UI-CONTRIB-009:** A renderer capability is a versioned semantic contract, not an implementation
  promise. For example, `acorn.code-editor/2` may use Monaco on Electron and a different editor on a
  future client.
- **UI-CONTRIB-010:** Host themes and styles control appearance. A plugin may select documented
  semantic tone, density or emphasis values but cannot supply arbitrary visual values.

## Bespoke contributions

- **UI-CONTRIB-011:** Bespoke UI uses an independently signed client artifact acquired and verified
  by Electron, then runs in the sandbox defined under [`bespoke`](./bespoke/package-and-host-contract.md).
- **UI-CONTRIB-012:** Bespoke UI does not receive implicit authority from its containing plugin,
  Node connection or owner session. All interaction uses revocable typed view-session grants.
- **UI-CONTRIB-013:** Every bespoke contribution MUST provide a semantic fallback or an explicit
  unsupported-platform state with equivalent recovery/navigation actions.
- **UI-CONTRIB-014:** Permission, secret, OAuth, native-execution, destructive confirmation,
  artifact trust, quarantine and recovery surfaces are always host-owned; bespoke UI cannot replace
  or visually overlay them.

## Contribution lifecycle

`declared → unavailable | registering → active ↔ suspended → unregistering → inactive`; any
validation or repeated runtime failure may enter `failed`.

- **UI-CONTRIB-015:** Contribution registration occurs only after plugin activation and compatible
  client-artifact verification. Registration is atomic per installation generation.
- **UI-CONTRIB-016:** On update, Electron constructs and validates the new contribution set before
  atomically switching generation. Views from the previous generation suspend and close after
  bounded state handoff.
- **UI-CONTRIB-017:** Disable, quarantine, permission revocation, dependency loss and Node
  disconnection update contribution availability immediately. Persisted navigation/layout identity
  remains as an unavailable placeholder where restoration is meaningful.
- **UI-CONTRIB-018:** A suspended contribution has no active stream, timer, focus, native surface or
  bespoke bridge. Session retention is a host optimization and may be dropped under memory pressure.

## Identity and context

- **UI-CONTRIB-019:** Each mounted contribution is identified by Node, installation, generation,
  contribution, view-session and host-surface IDs. Every action and patch carries the relevant
  identities and revisions.
- **UI-CONTRIB-020:** Host context is a signed/validated projection containing only fields declared
  for the host surface: Node connection, workspace/task/resource identity, client capabilities,
  locale/theme, presentation size class and authorized selection.
- **UI-CONTRIB-021:** Context changes invalidate or patch the view session according to the
  contribution declaration. A plugin cannot retain a broader old context after navigation.

## Common accessibility and security

- **UI-CONTRIB-022:** All contributions provide accessible name, optional description, landmark/
  heading placement and keyboard navigation behavior. Icon-only actions require text labels.
- **UI-CONTRIB-023:** Plugin content is untrusted for rendering and diagnostics. URLs, Markdown,
  images, file paths, terminal sequences and error text use renderer-specific sanitization.
- **UI-CONTRIB-024:** Sensitive view data is excluded from client persistence by default. A
  contribution must declare cache class and maximum age, and the Node can further restrict it.
- **UI-CONTRIB-025:** Conformance tests MUST mount every contribution kind in ready, loading,
  empty, error, offline, unsupported, denied, update, disable and crash states with keyboard and
  screen-reader assertions.
