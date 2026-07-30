# Streams, terminals and large payloads

Status: **Normative**
Requirement prefix: `CON-STREAM` / `CON-TERM` / `CON-OBJ` / `CON-CLIENTOP` / `CON-PREVIEW`

## Stream lifecycle

A command creates a stream resource and returns its URI plus access descriptor. The existing
multiplexed Node WebSocket carries:

1. `stream.open` with stream URI and last received offset;
2. `stream.opened` with current/oldest offsets and media type;
3. `stream.credit` granting a bounded number of bytes;
4. `stream.data` with monotonically increasing decimal offset and content;
5. optional `stream.input` for authorized duplex streams; and
6. `stream.close` / `stream.closed`.

- **CON-STREAM-001** Data MUST NOT be sent beyond granted credit. Maximum credit per stream is
  1 MiB; maximum data frame content is 64 KiB decoded.
- **CON-STREAM-002** Offsets count decoded bytes. Duplicate frames at an already applied offset are
  ignored only if the content digest matches; conflicting content closes the stream.
- **CON-STREAM-003** Stream authority is short-lived, device-bound and resource/operation-bound.
  Knowing a stream URI grants no access.
- **CON-STREAM-004** Stream loss does not cancel its process. Attach/detach and terminate are
  distinct commands.
- **CON-STREAM-005** Every stream profile fixes owner (`core` or one plugin installation),
  direction (`input`, `output`, or `duplex`), media type, maximum bytes, frame bytes, initial/
  maximum credit, replay window, sensitivity, cancellation behavior and required capability. A
  profile is digest-pinned in the plugin's operation descriptors; a runtime cannot create an
  undeclared stream shape.
- **CON-STREAM-005A** The authoritative plugin profile shape is
  [`stream-profile-v2.schema.json`](./schema/stream-profile-v2.schema.json). Manifests carry the
  profile and operation descriptors carry only its local ID. Core-owned stream profiles are
  advertised by the Node descriptor. Opening a profile reauthorizes every
  `requiredCapabilities[]` entry against the original delegated caller.
- **CON-STREAM-006** Community WASI runtimes use the WIT `stream-open/read/write/wait-credit/close`
  imports. The broker, not the component, owns external SSE/WebSocket/HTTP connections and converts
  only a declared destination/purpose into a bounded input stream. Plugin output streams use the
  same WebSocket stream frames after the host creates a node-qualified stream resource.
- **CON-STREAM-007** Handle and wire credit are one accounting chain. Host acceptance of a WIT
  write consumes component credit; WebSocket delivery consumes client credit; unread content is
  bounded by the worker profile and stream retention. Deadline, cancellation, revocation,
  generation switch or policy change wakes every waiter and closes the stream terminally.

## Terminals

Terminal output media type is `application/vnd.acorn.terminal-chunk+json`; it carries UTF-8 text or
base64 raw bytes, terminal dimensions and an output offset. Terminal input and resize require
separate command capabilities.

- **CON-TERM-001** Creating a terminal declares task URI, working-directory policy, shell/profile,
  dimensions and environment keys. Arbitrary working paths or inherited environment are prohibited.
- **CON-TERM-002** Input frames require `terminal.input` permission and a monotonically increasing
  client input sequence. Node deduplicates a sequence within the session.
- **CON-TERM-003** Output is retained as a 4 MiB ring for 15 minutes after detach. An earlier attach
  offset returns `stream_gap` and the oldest available offset.
- **CON-TERM-004** Terminal lifecycle events contain IDs/status only. Terminal input/output MUST NOT
  enter the general event outbox, audit log or application logs.
- **CON-TERM-005** Closing a view detaches; explicit `terminal.terminate` ends the PTY/process group.
  Node shutdown records termination reason and reconciles stale sessions on restart.

## Logs

Plugin/operation log streams are structured records with timestamp, level, component, request ID and
redacted attributes. Secret values, command input, terminal content and provider bodies are
prohibited. Default retained log stream is 10 MiB per runtime and seven days, subject to owner
configuration.

## Large objects

Payloads over JSON limits use content-addressed objects:

- `POST /v2/objects` creates a 15-minute upload grant with declared length, media type and SHA-256;
- `PUT` chunks use a content range, maximum 8 MiB, and digest;
- completion verifies total length/digest before returning an immutable object URI;
- downloads require a short-lived device/purpose-bound grant and support byte ranges.

- **CON-OBJ-001** Object IDs are `sha256:<64 lowercase hex>`, but deduplication MUST remain inside
  the same authorization/data-classification partition.
- **CON-OBJ-002** Maximum object size is 2 GiB by default. Archive and plugin limits may be lower.
- **CON-OBJ-003** Uploads are quarantined until length, digest, media type and operation-specific
  scanners pass. Partial uploads expire and are deleted.
- **CON-OBJ-004** Object paths are never accepted from clients. Filenames are inert metadata,
  normalized for display and never used as filesystem paths.
- **CON-OBJ-005** WASI output objects use the WIT create/append/commit/abort imports. Creation binds
  installation generation, delegated caller, owning resource, media type, exact/maximum length,
  expected digest, classification and purpose. Commit is the only point at which an object becomes
  addressable; failure, cancellation or stale generation deletes partial bytes.

## Remote preview tunnel

A directly connected Client cannot assume that a task development server bound to the Node's
loopback interface is reachable from the Client machine. Preview therefore uses a core-owned
authenticated tunnel, not the future Fleet relay.

- **CON-PREVIEW-001** The AsyncAPI `preview.tunnel.open` frame authorizes one paired device, task, resolved target,
  Preview view session and expiry of at most five minutes. The Node resolves and pins the exact
  destination address/port after applying task policy; the Client cannot supply or redirect it.
- **CON-PREVIEW-002** Electron exposes the tunnel to the isolated browser partition through an
  opaque ephemeral Client-loopback origin. Each tunneled request carries a UUIDv7 request ID,
  normalized method/path/headers and bounded body over a duplex stream; each response carries
  status/headers/body frames. Hop-by-hop headers, credentials, cookies outside the preview
  partition, proxy headers and forbidden methods are removed.
- **CON-PREVIEW-003** Redirects and every new DNS/address resolution are reauthorized against the
  original task target. Metadata endpoints, Node control listeners, Unix sockets, other task ports
  and arbitrary private-address targets are denied. Maximums are 32 concurrent requests, 16 MiB
  response per request, 64 MiB per tunnel and 60 seconds per request unless a lower policy applies.
- **CON-PREVIEW-004** Tunnel handles are non-transferable, never durable, never replayed, never
  logged, and close on view closure, task archive, plugin disable, grant revocation, device
  disconnect or target-policy change. Tunnel failure leaves the rest of the Node session usable.
- **CON-PREVIEW-005** AsyncAPI `preview.tunnel.open`, `preview.tunnel.opened`,
  `preview.http.request`, `preview.http.response`, `preview.http.cancel`,
  `preview.tunnel.close`, and `preview.tunnel.closed` are the complete tunnel
  state protocol. States are `requested`, `open`,
  `draining`, `closed`, `expired` and `revoked`; only `open` accepts requests.
  The authenticated socket supplies device identity. Open additionally binds
  tunnel UUID/URI, view capability, task, target and target generation,
  Client-origin generation, listener-token digest and expiry. Close is
  terminal and acknowledged with final request sequence and byte count; late
  or mixed-generation frames are rejected.
- **CON-PREVIEW-006** Electron creates a fresh 256-bit listener token, UUIDv7
  origin generation and random local TLS key/certificate for each tunnel. The
  origin is
  `https://p-<base32(HMAC-CMK(nodeId,deviceId,task,targetGeneration,viewSession,
  originGeneration,listenerTokenDigest))>.preview.acorn.invalid:<ephemeralPort>/`.
  Only that preview partition resolves the name to `127.0.0.1`/`::1` and trusts
  the ephemeral certificate. Every request requires exact `Host`, an HttpOnly/
  Secure/SameSite=Strict `__Host-acorn-preview` listener token and, for
  non-GET/HEAD, exact `Origin`; absent/foreign/multiple Host/Origin, stale port,
  wrong token or another partition closes the request without a Node frame.
- **CON-PREVIEW-007** Client ingress allows only GET, HEAD, POST, PUT, PATCH,
  DELETE and OPTIONS; path must be origin-relative. Request transport allows
  `accept`, `accept-language`, `content-type`, `if-match`,
  `if-none-match`, `if-modified-since`, `range`, `cookie`, and `user-agent`
  after per-field limits. It strips listener cookie, Acorn/device credentials,
  `host`, `origin`, `referer`, authorization, proxy/forwarded, connection,
  upgrade and all hop-by-hop headers. Node writes target Host and rewrites
  Origin/Referer only when target policy permits. Response allows safe content/
  cache/CORS/range headers and target `set-cookie` into this preview partition;
  it strips connection/proxy/authentication/client-certificate and Acorn
  headers. Header count is 64, each value 8 KiB and total 64 KiB.
- **CON-PREVIEW-008** Node resolves the target through a task-owned descriptor,
  pins address/port/generation and reauthorizes every redirect and DNS result.
  Redirect method changes follow RFC semantics but never expand allowed
  method/destination. Client and Node recompute body byte count/digest, enforce
  frame/stream credit and reject DNS rebinding, Node control ports, metadata,
  Unix sockets or another target. `client.operation.*` additionally matches the
  same authenticated device, view, task, target generation and Client-origin
  generation.
- **CON-PREVIEW-009** Preview partitions disable service workers, shared
  workers, cache persistence, downloads/popups/native permissions and external
  navigation by default. Tunnel terminal acknowledgement triggers stop,
  listener close, token/certificate/key erasure, cookie/cache/storage clear,
  service-worker unregister verification and partition destruction before the
  origin/port can be reused. Failure to verify teardown quarantines the
  partition identifier and port for the Electron process lifetime.

## Ephemeral Client operations

Some capabilities are Client-owned. In V2 the only required Node-to-Client operation is approved
Agent driving of an already open Preview browser. It uses `client.operation.request`,
`client.operation.result` and `client.operation.cancel` frames in AsyncAPI.

- **CON-CLIENTOP-001** A request is bound to the authenticated device, active view session,
  task-scoped grant, selected Client and a deadline no more than 30 seconds away. It names a
  manifest-declared operation and schema-valid bounded input. A Node cannot broadcast it or retry
  it on another Client.
- **CON-CLIENTOP-002** Electron reauthorizes the current view, Agent approval, operation, origin and
  user-presence policy before dispatch. Results are bounded and redacted. Screenshots larger than
  the frame limit use an authorized large-object reference.
- **CON-CLIENTOP-003** Requests/results are transient protocol frames, not product events. They are
  not replayed after reconnect, do not prove a committed fact, and never enter the event outbox.
  Disconnect, deadline, view closure, cancellation or capability revocation produces a terminal
  result and no automatic retry.
- **CON-CLIENTOP-004** Client-operation traffic has at most eight in-flight requests per view and
  256 KiB JSON input/output. Unknown operations, late/duplicate results, mismatched view sessions
  and results from another device are rejected and audited without payload content.
