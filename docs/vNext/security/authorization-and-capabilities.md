# Authorization and Capabilities

Status: normative
Requirement prefix: `SEC-AUTH`

Authentication identifies a principal. Authorization decides whether that
principal may perform the exact operation on the exact resource. UI visibility
is never an authorization control.

## Principals

The authorization engine recognizes `paired-client`, `core-service`,
`system-plugin`, `verified-plugin`, `community-plugin`, `developer-plugin`,
`bespoke-view-session`, and `delegated-call`. Every decision records principal,
plugin installation, Node-qualified resource, operation, grant version, and
delegation chain.

Paired clients have owner authority, but destructive ceremonies and local OS
confirmation still apply where required by
[identity-pairing-and-authentication.md](./identity-pairing-and-authentication.md).
Plugins never inherit owner authority.

## Capability grants

- **SEC-AUTH-001:** Authorization MUST be deny-by-default. A plugin manifest
  declares requested capability patterns; installation grants a concrete,
  owner-approved subset.
- **SEC-AUTH-002:** A persisted security grant MUST use
  `capability-v2.schema.json#/$defs/securityGrant` and bind plugin coordinate,
  publisher key identity, installation ID and monotonically increasing
  installation generation, exact artifact digest, capability ID/revision and
  operation set, closed resource selector, closed family-specific constraints,
  canonical permission-request digest, grant generation/version, decision
  actor/time, status, expiry/review time and revocation metadata. Missing or
  unknown fields fail closed.
- **SEC-AUTH-003:** An artifact digest or publisher change invalidates the grant.
  A compatible update with unchanged publisher and no permission expansion may
  carry forward a grant only after the update policy verifies it.
- **SEC-AUTH-004:** Capability checks MUST occur inside the core broker or
  privileged host immediately before side effects. A plugin's own check, a
  manifest declaration, a route guard, or a client decision is insufficient.
- **SEC-AUTH-005:** Broad wildcards, unrestricted process spawn, arbitrary network, arbitrary
  filesystem, terminal input, agent approval, and native execution are high-risk permissions and
  MUST be individually shown. A plugin request for raw-secret authority is not shown or
  approvable; it is rejected before permission review under `SEC-AUTH-030`.
- **SEC-AUTH-006:** Revocation increments the grant version, invalidates derived
  tokens and view sessions, closes affected streams, and prevents subsequent
  side effects. Already committed transactions remain.
- **SEC-AUTH-006A:** Renderer advertisements, manifest permission requests,
  negotiated capability availability and persisted security grants are
  different objects. They use the separate discriminated definitions in the
  capability schema and MUST NOT be accepted interchangeably. The canonical
  permission-request digest is SHA-256 over RFC 8785 canonical JSON of the
  exact signed request object.
- **SEC-AUTH-006B:** Any publisher key, artifact digest or installation
  generation change transitions every associated active grant to `superseded`.
  A staged update may create new pending grants, but activation cannot copy the
  old grant record. An unchanged verified request may be owner-policy
  re-approved into a new grant generation; carry-forward is a new audited
  decision referencing both generations.
- **SEC-AUTH-006C:** Dispatch loads the current grant by ID and version,
  verifies its active status, time policy, plugin/artifact/generation binding,
  requested operation, resource selector and complete typed constraints, then
  records the evaluated grant version. Cached decisions are invalidated by the
  same transaction that changes grant state. Unknown capability families or
  constraint revisions deny dispatch before plugin code runs.

The base capability namespace includes:

| Capability | Representative operations | Required scope |
| --- | --- | --- |
| `core.workspace` | list, inspect | workspace IDs |
| `core.file` | read, write, code-write, watch | workspace root plus path glob |
| `core.git` | read, stage, commit, branch, remote-write | repository ID |
| `core.terminal` | create, read-output, send-input, resize, terminate | task/workspace |
| `core.process` | fixed-tool, pty, spawn, signal | executable digest/path and workspace |
| `core.agent` | read, create, prompt, approve, terminate | workspace/task and profile |
| `core.network` | request, stream | scheme, host, port, path prefix, method |
| `core.secret` | use, rotate, delete, raw | secret reference and purpose |
| `core.ui` | contribute, bespoke, notify, attention | declared contribution IDs |
| `core.plugin` | call, subscribe, publish | dependency plugin and contract/event |
| `core.settings` | read, write | declared keys and scopes |
| `core.audit` | read-own, read-security | installation or owner |

The canonical capability schema is defined in
`../contracts/schema/capability-v2.schema.json`; manifests cannot invent
semantics by choosing a similar string.

The closed V2 constraint families are `workspace`, `file`, `git`, `terminal`,
`process`, `agent`, `network`, `secret`, `ui`, `plugin`, `settings`, `audit`,
`native`, and `docker`. Their schema fields are exhaustive. Adding a family or
changing a field's security meaning requires a new schema/capability revision,
not an extension property.

## Resource confinement

- **SEC-AUTH-007:** Every resource is node-qualified. A command received by one
  Node MUST reject an identifier naming another Node.
- **SEC-AUTH-008:** Workspace grants bind the immutable workspace ID, not a
  display path. Moving a worktree requires an authoritative remap.
- **SEC-AUTH-009:** A filesystem operation MUST resolve from an already-open
  workspace-root descriptor, reject absolute paths, `..`, NUL, alternate data
  streams, device paths, and platform aliases, and avoid check/use races through
  descriptor-relative operations.
- **SEC-AUTH-010:** Symlinks and junctions MUST be denied unless the grant
  explicitly allows following them and the final descriptor remains under the
  permitted root. Watching does not grant reading.
- **SEC-AUTH-011:** Process spawn MUST use an argv vector without a shell,
  unless `shell=true` is a separately granted permission. The executable,
  working directory, environment keys, inherited descriptors, and resource
  limits are broker-controlled.
- **SEC-AUTH-012:** Terminal input, clipboard paste, and agent approval are
  mutation capabilities distinct from reading output/transcripts.
- **SEC-AUTH-013:** Network grants match every redirect hop and resolved
  destination. DNS resolution MUST defend against rebinding; private, loopback,
  link-local, metadata, Unix-socket, and non-HTTP(S) destinations are denied
  unless explicitly and narrowly granted.
- **SEC-AUTH-014:** Upload/download size, content type, decompression ratio,
  redirect count, response time, and response byte limits are enforced before
  data reaches the plugin.
- **SEC-AUTH-015:** Credential injection occurs after destination validation.
  Credentials MUST be stripped before redirects to a different origin.

## Inter-plugin collaboration

- **SEC-AUTH-016:** A plugin may call or subscribe to another plugin only through
  a manifest-declared, version-compatible dependency and core broker.
- **SEC-AUTH-017:** Effective authority is the intersection of caller authority,
  explicit delegation, callee declaration, and callee grant. A callee MUST NOT
  substitute its independent broader grant for a delegated request.
- **SEC-AUTH-018:** Delegation tokens MUST be audience-, operation-, resource-,
  purpose-, grant-version-, and call-chain-bound, expire within 60 seconds, be
  single-use for mutations, and never be visible to plugin code as bearer text.
- **SEC-AUTH-018A:** Core mints an opaque 256-bit delegation handle for an
  invocation. Its authoritative record contains the initiating device/system
  principal, optional agent/session, ordered plugin installation and generation
  hops, audience export/version, operation, resource, purpose, deadline,
  correlation ID and the exact grant ID/version intersected at each hop.
  Plugins may inspect only the redacted descriptor through the bound host
  import; they cannot create, alter, persist, delegate outside the broker or
  select the grant set.
- **SEC-AUTH-018B:** A downstream call consumes the current handle and creates a
  child whose authority is the intersection of its parent and current policy.
  Audience/resource/operation/purpose substitution, expired/replayed mutation
  handles, revoked grants, cancelled roots and forged caller fields return
  `delegation_invalid` or `delegation_revoked`. Cancellation and revocation
  walk the child tree before any later commit.
- **SEC-AUTH-019:** Event receipt proves only that an event was emitted. Before
  a security-sensitive side effect, the consumer MUST reauthorize and read
  current authoritative state. Expired replay cursors force a snapshot.
- **SEC-AUTH-020:** Direct cross-plugin imports, cross-plugin SQL, private
  endpoints, shared mutable objects, ambient environment credentials, and
  plugin-to-plugin sockets are prohibited. Build and boundary tests MUST
  enforce the prohibition.

## Repository-authored executable input

- **SEC-AUTH-021:** Repository configuration, workflows, hooks, agent
  instructions, and commands are untrusted even in a previously approved repo.
- **SEC-AUTH-022:** Before first execution, core MUST present the exact
  normalized snapshot, provenance, requested capabilities, and diff from the
  last accepted digest.
- **SEC-AUTH-023:** Trust is machine-, repository-, and digest-scoped. Any
  executable-field change invalidates it. Declarative data that cannot cause
  execution may be separately classified.
- **SEC-AUTH-024:** A denied or expired trust decision MUST fail with a stable
  `needs-trust` error and create an attention item. It MUST NOT fall back to a
  lower-precedence command or silently resume after approval.
- **SEC-AUTH-025:** Agent-initiated execution cannot approve trust or permission
  expansion.
- **SEC-AUTH-026:** Repository trust permits the reviewed configuration to
  request an already granted execution capability; it does not itself grant
  filesystem, network, secret, process, or agent authority.
- **SEC-AUTH-026A:** Docker Compose is repository-authored executable input.
  Non-executable names/labels may match existing resources without trust, but
  build/up/start/restart/exec/stop/down require the complete input-graph and
  materialized-plan digest in `CUR-DOCKER-011A` through `CUR-DOCKER-011B`.
  Privilege, host mounts/socket/devices/namespaces/capabilities and external
  secrets are separately granted high-risk effects; executable and argv
  allowlisting alone is insufficient.

## Preview tunnels and Client operations

- **SEC-AUTH-027:** A remote preview tunnel is authorized only after resolving one exact
  task-owned target. Core pins its destination and revalidates every redirect/address; the Client
  cannot use it as a generic proxy, reach Node control listeners, attach credentials from another
  origin, or transfer the handle to another view/device.
- **SEC-AUTH-028:** A Node-to-Client operation is permitted only for a manifest-declared
  Client-owned capability, selected paired device, active view session, exact task/resource,
  current delegated Agent approval and unexpired request. The Client reauthorizes independently and
  MUST reject broadcast, another device, another view, late replay or broader callee authority.
- **SEC-AUTH-029:** Preview tunnel and Client-operation handles close synchronously on view closure,
  device/plugin/grant revocation, task archive, destination change or disconnect. They are
  transient capabilities, not product events, and MUST NOT be replayed or reassigned on reconnect.

## Incompatible authority combinations

- **SEC-AUTH-030:** `core.secret.raw` is prohibited in V2. System and Verified
  integrations that cannot use a general broker MUST use an Acorn-owned,
  provider-specific credential helper whose fixed protocol, destination,
  operation and sandbox are release-reviewed. The helper is not plugin code
  and never returns credential bytes.
- **SEC-AUTH-031:** The policy engine MUST reject any request or lock that would
  combine a secret-bearing helper process with direct sockets, child processes,
  writable unbrokered files, inherited handles, debugger/diagnostic attachment
  or core dumps. The denial applies for the process lifetime, not only one
  invocation. Revocation terminates the helper and destroys its ephemeral
  secret-bearing state.

## Authorization decision response

Internal decisions have one of `allow`, `deny`, `prompt-required`, or
`reauthentication-required`. External callers receive stable, non-oracular
errors. Denials identify the missing capability to an owner client but MUST
redact whether a secret, hidden resource, or other plugin installation exists
when the caller lacks visibility.
