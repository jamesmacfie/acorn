# Plugin Trust and Runtime Isolation

Status: normative
Requirement prefix: `SEC-PLUG`

Trust tier describes provenance and review. Runtime tier describes containment.
Neither grants authority; capabilities do.

## Trust and runtime matrix

| Trust tier | Declarative | WASI Component | Bespoke UI | Sandboxed native | In-process |
| --- | --- | --- | --- | --- | --- |
| System | yes | yes | bundled only | bundled only | explicit allowlist only |
| Acorn Verified | yes | yes | signed client artifact | only with enforced sandbox | no |
| Community | yes | yes | signed client artifact | no | no |
| Developer Source | yes | yes | local artifact | sandboxed, or explicit unrestricted mode | no |

- **SEC-PLUG-001:** Only Acorn-signed System plugins named by the shipped System
  plugin allowlist may run in-process.
- **SEC-PLUG-002:** System status is not installable from Community, Developer
  Source, repository configuration, local manifest changes, or a publisher
  signature.
- **SEC-PLUG-003:** Verified, Community, and Developer plugins authenticate as
  distinct installation principals and use the same core broker as remote
  calls, even when hosted on the same machine.
- **SEC-PLUG-004:** Plugin packages cannot import private core modules or another
  plugin. Public generated SDK contracts are the only compile-time dependency.
- **SEC-PLUG-005:** Each plugin database, files directory, cache, event cursor,
  and runtime directory is owned by its installation ID and unavailable by
  path or handle to sibling plugins.
- **SEC-PLUG-006:** Core passes serializable values, bounded streams, and opaque
  handles only. Database handles, process objects, sockets, Electron objects,
  credential handles, and native file descriptors do not cross unless their
  capability explicitly defines a constrained handle.
- **SEC-PLUG-007:** Plugin host crashes cannot crash the Node. Core supervises
  lifecycle, closes grants/streams, records diagnostics without sensitive data,
  and applies restart/quarantine policy.
- **SEC-PLUG-008:** Plugin code cannot register arbitrary HTTP endpoints,
  listeners, protocol handlers, Electron IPC, preload APIs, global shortcuts,
  or OS launch agents. Contributions are declared and mediated by core.
- **SEC-PLUG-009:** Plugin identity includes plugin ID, publisher, installation
  ID, artifact digest, runtime tier, and grant version. Reusing a process for
  different identities is forbidden.
- **SEC-PLUG-010:** Debug attachment and developer inspection are disabled for
  production plugin runtimes and require an explicit Developer Mode session.

## WASI Component runtime

- **SEC-PLUG-011:** Community executable plugins MUST use the versioned Acorn
  WIT world and a WASI Component runtime configured with no ambient
  capabilities.
- **SEC-PLUG-012:** Filesystem, sockets, DNS, clocks, randomness, environment,
  stdio, process, signals, and host imports are absent unless a specific Acorn
  capability supplies a constrained equivalent.
- **SEC-PLUG-013:** The component receives virtual monotonic time by default.
  Wall clock and secure randomness require declared operations when their use
  affects externally visible behavior.
- **SEC-PLUG-014:** Preopened directories are forbidden. File operations use
  opaque workspace handles and broker calls, not host paths.
- **SEC-PLUG-015:** Raw outbound WASI sockets are forbidden. All network access
  uses the brokered network/credential capability.
- **SEC-PLUG-016:** Host calls validate WIT values, string encoding, collection
  length, recursion depth, handle ownership, and numeric bounds before use.
- **SEC-PLUG-017:** Default per-call limits are 64 MiB linear memory, 100
  million fuel units, 30 seconds wall time, 16 concurrent host calls, 1 MiB
  request, 8 MiB response, and 64 MiB streamed output. A grant may lower them;
  increasing them requires an owner-visible resource permission.
- **SEC-PLUG-018:** Background workers receive a declared CPU budget of 60
  seconds per rolling five minutes and a minimum one-second wake interval.
  Higher limits require an owner-visible resource grant.
- **SEC-PLUG-019:** Component output, errors, logs, and event payloads are
  bounded and schema-validated. Trap details exposed externally omit host paths,
  internal stack, memory, and secrets.
- **SEC-PLUG-020:** Fuel or epoch interruption MUST terminate runaway code.
  Repeated quota violations contribute to health failure and quarantine.
- **SEC-PLUG-021:** Compiled component caches are keyed by runtime version and
  artifact digest and are non-authoritative. Cache corruption causes rebuild,
  not fallback to unverified code.
- **SEC-PLUG-022:** Runtime security updates may force component suspension until
  recompiled/revalidated; compatibility does not override a critical sandbox
  fix.

## Native process runtime

- **SEC-PLUG-023:** Acorn Verified native code may activate only if the host
  passes the native-sandbox conformance probe for every granted operation.
  Unsupported or degraded sandboxing is a hard activation failure.
- **SEC-PLUG-024:** Each native installation runs as a separate least-privilege
  child under an enforceable OS sandbox, not merely a child process with a
  filtered environment.
- **SEC-PLUG-025:** The sandbox denies the data root, credential store, other
  plugin roots, arbitrary worktrees, home directory, device files, system
  configuration, raw sockets, debugger/process inspection, privilege changes,
  and child processes by default.
- **SEC-PLUG-026:** Filesystem access uses broker handles or narrowly mounted
  read-only/read-write paths derived from grants. A writable plugin scratch
  directory has a default 1 GiB quota.
- **SEC-PLUG-027:** Native network access uses a broker channel by default and
  the sandbox blocks direct sockets. A dedicated Verified capability may allow
  exact constrained egress where brokered transport is impossible, but it
  cannot receive broker-managed credential plaintext and remains subject to
  scheme/host/port/IP/rate policy.
- **SEC-PLUG-028:** Executables and libraries load only from the verified,
  read-only artifact root. Dynamic library search paths, runtime injection,
  preload variables, and writable executable mappings are denied.
- **SEC-PLUG-029:** Environment begins from an empty allowlist and contains no
  Node/client keys, provider credentials, internal tokens, inherited shell
  config, proxy credentials, or user environment.
- **SEC-PLUG-030:** Core communicates over a private authenticated IPC channel
  with framed, versioned, bounded messages. The child cannot choose a listener
  address or connect as another installation.
- **SEC-PLUG-031:** Default limits are 512 MiB resident memory, 50% of one CPU,
  128 processes/threads combined only when process spawning is granted
  (otherwise one process), 256 handles, 1 GiB scratch, and the same broker rate
  limits as WASI.
- **SEC-PLUG-032:** Sandbox denial, unexpected executable load, prohibited
  syscall, signature change, repeated crash, or quota abuse is a security
  health failure and triggers quarantine.
- **SEC-PLUG-033:** Core dumps and crash uploads are disabled by default. An
  owner-exported diagnostic bundle is redacted and never includes process
  memory.
- **SEC-PLUG-034:** Developer Source may request `unrestricted-native`. The UI
  MUST state that this is arbitrary code execution with the owner's OS access,
  require typing the plugin ID, and never label it sandboxed or safe.
- **SEC-PLUG-035:** Unrestricted mode cannot be enabled remotely, by a plugin,
  by repository config, by marketplace metadata, or by update carry-forward.
  Every artifact digest change requires the ceremony again.

## System plugin constraints

System plugins are in Acorn's trusted computing base, but they MUST expose typed
contribution points, validate all external inputs, avoid cross-plugin databases,
and use core-owned process/files/network/credential primitives. Boundary tests
MUST fail if a new private cross-feature import or ambient capability appears.
