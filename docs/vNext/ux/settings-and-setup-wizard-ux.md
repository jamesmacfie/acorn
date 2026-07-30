# Settings and setup-wizard UX

Status: Normative<br>
Requirement prefix: `UX-SETUP`

## Settings information architecture

Settings retains the shipped modal/navigation model and adds Node, Plugins and Devices:

- General: Workspaces, Appearance, Integrations, MCP, Agent tools, Agent pricing, Workflows,
  Terminal, Docker, API requests, Shortcuts, Permissions, Automation API, Plugins, Nodes/Devices;
- Workspace: identity, repositories/projects and per-repository execution/database/preview settings;
- Plugin: plugin-declared pages grouped below the owning Node/installation;
- Developer-only: Style gallery and future Plugin Studio entry, visibly non-production.

- **UX-SETUP-001:** Every page header shows effective scope. Node-owned settings show Node; workspace/
  repository/task pages show canonical ancestry; client presentation pages show This device.
- **UX-SETUP-002:** Settings search indexes safe labels/descriptions, not secret values, provider
  payloads or hidden unavailable controls.
- **UX-SETUP-003:** Plugin settings cannot insert above mandatory Node, Permissions, Plugins,
  Devices, Security/Recovery or owner controls.
- **UX-SETUP-004:** Save status is explicit: dirty, validating, saving, saved, conflict, restart
  required, setup required or failed. Navigation close protects dirty input.
- **UX-SETUP-005:** Inherited settings show source scope and separate Reset to inherited from Set
  default. Client-local appearance/layout cannot be mistaken for shared Node behavior.
- **UX-SETUP-006:** Secret settings expose presence/health and Replace/Delete/Test where declared,
  never value/prefix/length/copy. Entry uses the host secure control.

## Setup queue

- **UX-SETUP-007:** Required setup opens from install or attention; multiple setup instances appear
  in a queue grouped by Node/plugin and never stack modals.
- **UX-SETUP-008:** Wizard header always shows verified plugin name/coordinate, Node label/
  fingerprint fragment, purpose and progress. Security/permission steps use host-exclusive chrome.
- **UX-SETUP-009:** Closing preserves resumable Node state and creates attention. Cancel explains
  retained artifacts/settings/secrets/external effects and offers Keep for later or Remove plugin.
- **UX-SETUP-010:** Any paired owner client can resume. If another client advanced the wizard, the
  current one reloads current step and does not overwrite it.

## Step behavior

- **UX-SETUP-011:** Information: clear purpose, data flow and safe links; Continue never implies a
  hidden permission.
- **UX-SETUP-012:** Permission: compare requested/current authority and show denial consequence;
  owner can inspect full constraints.
- **UX-SETUP-013:** Form/secret: inline plus summary validation; secrets clear after submission/
  close/failure and are never recoverable from Back.
- **UX-SETUP-014:** OAuth/device flow: show provider, target Node and browser/device state; owner can
  cancel/retry; callback replay or wrong state is a safe failure.
- **UX-SETUP-015:** Resource selection: searchable/paged authorized items, stable selected summary,
  unavailable item explanation and Node-side revalidation.
- **UX-SETUP-016:** Async operation: durable phase/progress, elapsed time, cancel semantics,
  reconnect state and safe diagnostics; completion survives client closure.
- **UX-SETUP-017:** Confirmation: summarize exact settings, resources, permissions and external/
  destructive effects using host-owned risk treatment.
- **UX-SETUP-018:** Result: distinguish complete, complete with optional degradation, partial
  external effects and failed; offer only valid next/recovery actions.

## Accessibility and failure

- **UX-SETUP-019:** Wizards support keyboard/screen reader, logical focus, error summary, reduced
  motion, 200% zoom, compact size and safe interruption by Node disconnect.
- **UX-SETUP-020:** Node offline freezes current validated state, disables Continue and offers Close
  and Retry. It never caches a secret for later submission.
- **UX-SETUP-021:** Raw provider/plugin errors are mapped to safe message, stable code, correlation
  and remediation; advanced diagnostics remain redacted.

## Acceptance

- **UX-SETUP-022:** Acceptance runs all standard step kinds, Back/cancel/close/reopen, two clients,
  Node disconnect, secret/OAuth failures, long async restart, scope conflicts, plugin update during
  setup and complete keyboard/screen-reader flow.
