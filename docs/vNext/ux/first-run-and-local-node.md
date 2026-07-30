# First run and the local Node

Status: Normative<br>
Requirement prefix: `UX-FIRST`

The default V2 experience remains a self-contained Electron application. Electron installs,
bootstraps and supervises a local Acorn Node, then uses the same authenticated protocol as a remote
Node through a pre-established local trust relationship.

## Fresh-install sequence

1. Electron opens immediately with Acorn brand, progress and recovery access.
2. It locates or installs the release-matched local Node binary/runtime and verifies its signature.
3. It creates a V2 data root without inspecting or modifying V1 state.
4. It creates owner client identity and local Node identity using OS-backed keys.
5. It bootstraps mutual trust over a one-use inherited local channel; no pairing code is shown.
6. It starts the Node on a random loopback endpoint and completes ordinary protocol/capability
   negotiation.
7. It activates system plugins and installs the signed default plugin profile.
8. It opens required integration/setup flows, imports selected workspace/repository configuration
   when offered, and creates the Default workspace for newly discovered repositories.
9. It restores or seeds the shipped Electron shell and shows the same default review/task UX.

- **UX-FIRST-001:** First run MUST never require the owner to understand Nodes, ports, certificates
  or plugin artifacts to obtain the current local Acorn experience.
- **UX-FIRST-002:** The local Node is Electron-free and runnable independently, but the bundled
  Electron client owns its supervised startup, health display, release compatibility and ordinary
  stop at application shutdown according to active-work policy.
- **UX-FIRST-003:** Local bootstrap uses the same logical authentication, resource IDs, commands,
  events and UI contracts as remote operation. A hidden privileged renderer-to-service product API
  is prohibited.
- **UX-FIRST-004:** Bootstrap credentials are generated, transferred once over an inherited/
  filesystem-protected channel, stored with OS-backed protection and erased from temporary state.
  A loopback source address alone is never trusted.
- **UX-FIRST-004A:** The complete local protocol, binary/peer checks, transcript,
  proofs, atomic commit and crash reconciliation are `CON-BOOT-001` through
  `CON-BOOT-006`. UI presents Verify installation, Starting Node, Establishing
  owner trust, Saving credential and Complete from persisted state. A recovery
  screen may Resume the exact journal or remove only the still-unpaired new V2
  root after showing its path and bootstrap ID; it cannot mint a second owner.
- **UX-FIRST-005:** Electron MUST use a random available loopback port or local IPC rendezvous
  record and authenticated discovery. Fixed `127.0.0.1:4317` is not a V2 identity or trust boundary.

## Default profile

The profile contains system GitHub, Terminal and Agents plus bundled Acorn Verified Changes,
Context, Database, Docker, Editor, HTTP, Memory, Notes, Onboarding, Preview and Workflows; Acorn
Verified reference Linear, Rollbar and Model Providers; and the Aider, Claude and Codex profiles.

- **UX-FIRST-006:** Default profile installation is shown as one Acorn setup operation and uses the
  same verified lifecycle as marketplace installation. Required system artifacts are release-bound;
  bundled verified plugins remain independently represented and manageable where safe.
- **UX-FIRST-007:** No bundled plugin receives permission merely because it is in the default
  profile. Routine required grants are explained during first run; high-risk/native/secret/external
  effects use their normal prompts.
- **UX-FIRST-008:** Profile failure identifies the affected feature, preserves successful
  installations, offers Resume/Retry/Use Reduced Acorn/Diagnostics, and still opens plugin and Node
  management.

## GitHub and repository onboarding

- **UX-FIRST-009:** Acorn identity/pairing is independent from GitHub. GitHub setup occurs after
  local Node trust and stores provider credentials only in the local Node vault.
- **UX-FIRST-010:** After GitHub/repository discovery, first run creates a Default workspace and
  assigns unassigned visible repositories idempotently, preserving current behavior.
- **UX-FIRST-011:** Onboarding allows creating workspaces, assigning each repository to exactly one,
  mapping a local checkout through the native folder picker, hiding/showing repositories and
  completing later through Settings → Workspaces.
- **UX-FIRST-012:** Workspace/repository configuration import is opt-in, previews source and
  destination, writes only to the separate V2 data root, and never imports V1 tokens, tasks,
  sessions, notes, plugin data, preferences or API credentials.

## Returning startup

- **UX-FIRST-013:** Startup shows the shell from verified client state while it authenticates the
  local Node, but confidential cached bodies remain subject to owner/profile/grant checks.
- **UX-FIRST-014:** Restore order follows Fleet/Node, workspace, source/task, pane layout and view
  sessions. Default initialization cannot overwrite saved state during restore.
- **UX-FIRST-015:** Local Node upgrade, migration or recovery progress is explicit. Electron never
  opens an incompatible Node through an unversioned fallback.
- **UX-FIRST-016:** If the local Node cannot start, Electron provides Retry, View Safe Diagnostics,
  Restore Compatible Backup, Open Data Location, Run Reduced Fleet with remote Nodes, and Quit. It
  does not silently create a new empty identity/data root over the failed one.

## Shutdown

- **UX-FIRST-017:** Quit asks the Node to drain client-independent operations according to policy.
  Running terminals/agents/workflows show Continue in Background, Stop Safely, Cancel Quit where
  supported; force termination states possible loss clearly.
- **UX-FIRST-018:** Closing the Electron window does not imply owner logout, Node unpair or plugin
  uninstall. Those are separate explicit operations.

## Acceptance

- **UX-FIRST-019:** Acceptance covers offline fresh install from bundled artifacts, first GitHub
  setup, configuration import/decline, default profile partial failure, random port collision,
  interrupted bootstrap, local Node identity mismatch, returning restore and shutdown with active
  work.
- **UX-FIRST-020:** Packaged and development acceptance covers descriptor/pipe
  substitution, wrong or changed child binary, unexpected peer PID, parallel
  bootstrap, transcript replay, parent/child death and a crash before/after
  every persisted transition. The outcome is exactly one usable owner device
  or a visibly clean unpaired root; reusable secret material never remains.
