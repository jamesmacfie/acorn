# Complete native plugin example

**Status:** Normative example<br>
**Example coordinate:** `acme/docker-watch`<br>
**Requirement prefix:** `EX-NATIVE`

The validated manifest is
[`plugin-manifest-native.json`](../contracts/examples/plugin-manifest-native.json). This example
exists to prove that “native” means a separately supervised, enforceably sandboxed Node process,
not arbitrary Electron or in-process code.

## Eligibility and purpose

Docker Watch subscribes to local Docker events, produces normalized container/service state, and
renders a task status source. It requires a native process because the supported platform broker
uses a platform-specific Docker transport unavailable to the WASI host.

It is Acorn Verified and includes source commit, reproducible build provenance, SBOM, transparency
entry, macOS signature/notarization, and exact `darwin/arm64` executable digest. Other platform
artifacts are separate signed selections.

`EX-NATIVE-001` Installation MUST fail on a platform without the reviewed sandbox or without a
matching signed artifact. It MUST NOT offer an “install anyway” path outside Developer Source mode.

## Sandbox and launch

The Node launches the verified executable directly with:

- no shell;
- arguments `serve --protocol=2 --ipc-fd=<inherited>`;
- a private empty working directory;
- environment containing locale plus installation/generation IDs only;
- one mutually authenticated length-prefixed IPC handle;
- read-only executable/libraries;
- a private 64-MiB temporary directory; and
- the exact Docker event broker/device handle granted by the owner.

Home, Acorn databases, plugin databases, keychains, browser profiles, SSH agents, general network,
Electron IPC, Node listeners, devices, inherited descriptors, child processes, and crash dumps are
denied. Plugin persistence uses the broker, not direct database files.

Default ceilings are one process, no children, 128 MiB memory, one CPU core equivalent, 1 MiB
control frames, 16 MiB/s stream burst, and bounded restart policy.

`EX-NATIVE-002` Docker authority is limited to event/read inspection for containers associated with
the selected workspace/project labels. It does not include exec, start/stop/remove, image, volume,
secret, or arbitrary socket operations.

## Protocol and contributions

The process exports health, subscribe/unsubscribe, snapshot, drain, and shutdown. Every request
includes installation/generation, caller chain, capability, target resource, correlation,
deadline, and cancellation identity. Core reauthorizes every Docker operation.

The Client artifact is declarative. It contributes a workspace source, task badge/pane, settings
page, and normalized timeline using built-in list/status/table/log renderers. It has no bespoke UI.

Events are `dev.acme.docker-watch.container-state-changed.v1`,
`project-health-changed.v1`, and `worker-degraded.v1`. They contain canonical task/project/container
identifiers, normalized state, timestamp, and safe reason—not environment, mounts, labels outside
the selected matcher, command, logs, or socket details.

## Lifecycle

Install verifies artifact/provenance, validates the platform sandbox, shows the native authority
ceremony, applies the grant, starts the process, checks protocol/health, obtains a bounded snapshot,
and activates Client contributions.

Update starts a parallel sandboxed generation for readiness but grants effectful event ownership to
only one generation at the activation commit. The old generation drains and loses all handles.

A sandbox violation, protocol forgery, unexpected child, forbidden path/socket attempt, signature
change, or repeated crash quarantines the installation. Quarantine stops the process tree and keeps
read-only normalized state available with an explicit warning.

Uninstall terminates the process tree, revokes broker/device handles, removes schedules/IPC/client
contributions, then applies the owner’s plugin-data retention choice.

## Developer Source contrast

An unsigned or unsandboxable build can run only through Developer Source after a separate ceremony
stating that it is unrestricted code execution as the OS user. It is permanently badged and is not
described as capability-confined. That mode is not eligible for the trusted or Community
marketplace.

## Conformance

- Tamper with executable, libraries, signature, provenance, manifest, SBOM, or platform selector:
  installation fails.
- Probe home, data roots, keychains, browser, SSH, network, local IPC, other plugins, device nodes,
  and inherited descriptors: the OS sandbox denies them.
- Attempt Docker mutation or inspect an unmatched project: broker denies it.
- Fork/exec a child and leave an orphan: creation fails or the supervisor kills the process tree.
- Flood IPC/output, hang health, exhaust memory/CPU, crash repeatedly, or violate sandbox:
  limits/quarantine apply without Node failure.
- Reuse a handle after grant revocation or update: rejected.
- Attempt to deliver executable UI from the Node: Client ignores it and resolves only the signed
  declarative artifact.
