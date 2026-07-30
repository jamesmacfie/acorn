# Native process runtime

Status: Normative<br>
Requirement prefix: `PLUG-NATIVE`

Native plugins exist for verified integrations that cannot be expressed by declarative or WASI
Components. Native capability is exceptional, not the community default.

## Eligibility and sandbox

- **PLUG-NATIVE-001:** Native artifacts require Acorn Verified trust, publisher signature, build
  provenance, SBOM, exact platform selector, platform code-signing/notarization where available,
  and an Acorn-approved review record.
- **PLUG-NATIVE-002:** Activation requires a real OS sandbox that enforces filesystem, process,
  network, IPC, device, environment, CPU, memory and child-process policy for the declared
  platform. Missing enforcement fails closed.
- **PLUG-NATIVE-003:** macOS implementations MUST use a dedicated sandbox profile and process
  identity; equivalent mandatory isolation is required on other supported systems. A language-level
  wrapper alone is not an OS sandbox.
- **PLUG-NATIVE-004:** Unsandboxed execution is only Developer Source mode after a confirmation
  that names the executable, digest, publisher/source, requested scope and fact that it can execute
  arbitrary code as the user. It remains permanently badged and audit-visible.

## Process protocol

- **PLUG-NATIVE-005:** The supervisor launches an exact verified executable path without a shell,
  with an explicit argument vector, minimal environment, controlled working directory and inherited
  handles limited to the protocol transport.
- **PLUG-NATIVE-006:** The protocol is length-prefixed, versioned, mutually authenticated local IPC
  with 1 MiB control-frame and negotiated stream limits. `stdout`/`stderr` are diagnostics and
  cannot carry control messages.
- **PLUG-NATIVE-007:** Every request includes installation, generation, caller, capability,
  correlation, deadline and cancellation identity. The core reauthorizes brokered effects; process
  claims do not establish authority.
- **PLUG-NATIVE-008:** The supervisor enforces startup, heartbeat, graceful drain and kill
  deadlines; crash-loop backoff; maximum restarts; process-tree termination; output rate limits; and
  orphan cleanup after Node restart.

## Authority

- **PLUG-NATIVE-009:** The sandbox filesystem exposes only verified executable/library files
  read-only, an isolated temporary directory, and expressly granted resource roots. Plugin data is
  accessed through a broker unless a verified performance exception grants its own data directory.
- **PLUG-NATIVE-010:** Direct internet sockets are denied by default. Brokered HTTP is preferred.
  Direct network capability requires exact egress constraints and cannot receive broker-managed
  credential plaintext.
- **PLUG-NATIVE-011:** Child processes are denied by default. A grant names executable digest or
  system-tool identity, argument grammar, working-directory class, environment, process count,
  duration and output bounds.
- **PLUG-NATIVE-012:** Access to Electron IPC, local Acorn listeners, other plugin IPC, browser
  profiles, SSH agents, keychains, Docker sockets, user home, devices and inherited cloud
  credentials is denied unless a dedicated reviewed capability explicitly names it.
- **PLUG-NATIVE-013:** Native UI is not hosted in-process. Any client UI remains declarative or an
  independently sandboxed bespoke UI artifact.

## Lifecycle and recovery

- **PLUG-NATIVE-014:** Native processes start only after artifact verification, sandbox validation,
  grant resolution, storage migration and setup gates succeed.
- **PLUG-NATIVE-015:** Update stages a parallel generation but only one generation may make
  non-idempotent effects after the activation commit point. Old generation handles are revoked at
  switch.
- **PLUG-NATIVE-016:** A sandbox violation is a security health event and triggers immediate
  termination. Repeated or high-confidence violations quarantine the installation without automatic
  restart.
- **PLUG-NATIVE-017:** Crash dumps are disabled by default for secret-bearing processes. Any
  diagnostic capture is encrypted, bounded, redacted and owner-consented.

## Conformance

- **PLUG-NATIVE-018:** Each supported platform MUST have an executable conformance suite proving
  denied home-directory access, denied Acorn/database access, denied socket/IPC escape, descendant
  termination, resource ceilings, revocation, crash-loop quarantine and artifact tamper rejection.
