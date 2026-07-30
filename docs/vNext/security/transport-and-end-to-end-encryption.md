# Transport and End-to-End Encryption

Status: normative
Requirement prefix: `SEC-TRANS`

V2 direct transport is end-to-end between Electron and the Acorn Node. The
future relay transport adds application-layer encryption so the relay never
terminates product-data confidentiality.

## Direct transport

- **SEC-TRANS-001:** Nodes MUST expose only TLS 1.3 for V2 HTTPS and WebSocket.
  TLS 1.2 and below, plaintext HTTP, opportunistic encryption, and mixed content
  are forbidden.
- **SEC-TRANS-002:** Connections after enrollment MUST use mutual TLS with the Node and paired
  device identities from the pairing specification. The two pre-credential claim routes named by
  `SEC-ID-010` instead use fingerprint-pinned TLS 1.3 server authentication and their transcript
  proofs; they cannot present a device certificate that has not yet been issued. The client MUST
  verify the pinned RFC 8410 Node-identity SPKI in addition to certificate validity and endpoint.
- **SEC-TRANS-003:** TLS configuration MUST prefer
  `TLS_AES_256_GCM_SHA384` and permit `TLS_CHACHA20_POLY1305_SHA256`;
  compression and 0-RTT MUST be disabled.
- **SEC-TRANS-004:** Certificates and private keys MUST never cross into the
  normal Electron renderer. A narrow native network adapter owns them and
  exposes typed V2 operations to the sandboxed Acorn renderer.
- **SEC-TRANS-004A:** V2 direct transport permits only end-to-end TLS or
  layer-four TLS passthrough. TLS-terminating proxies, forwarded-certificate
  headers and a proxy certificate substituted for the paired Node or device
  are unsupported and rejected. The Node itself observes and validates the
  client certificate and derives the WebSocket ticket binding from its TLS
  exporter.
- **SEC-TRANS-005:** A Node MUST bind only configured interfaces. Enabling a
  non-loopback listener is an owner ceremony showing all interfaces, firewall
  state, TLS fingerprint, and exposure risk. V2 MUST never auto-enable public
  bind.
- **SEC-TRANS-006:** HTTP `Host`, TLS SNI, request origin, content type, body
  size, method, and version MUST be validated before route dispatch. CORS is
  deny-all; the Acorn Electron origin is explicitly allowed. Cookie
  authentication and CSRF are not used by V2.
- **SEC-TRANS-007:** Every response applies `no-store` for sensitive material,
  a stable request ID, bounded error envelope, and no stack, raw provider body,
  filesystem path, SQL, key, or credential.

## Message integrity, replay, and ordering

- **SEC-TRANS-008:** Every command is evaluated with the authenticated connection's pinned Node ID
  and mTLS device ID; those identities MUST NOT be accepted from payload claims. The envelope MUST
  contain `apiVersion`, `commandId` (also the idempotency identity), node-qualified target,
  `sessionRevision`, deadline and expected resource revision where applicable. UUIDv7 time and the
  deadline enforce the command-age bounds in `CON-CMD-007`.
- **SEC-TRANS-009:** The Node MUST reject a command for another Node, expired
  command, impossible future time beyond 120 seconds, duplicate non-idempotent
  identifier, or incompatible protocol before side effects.
- **SEC-TRANS-010:** Idempotency results MUST bind authenticated device, operation, resource and
  normalized request hash. Terminal results are retained for at least seven days and non-execution
  tombstones for 30 days as required by `CON-CMD-005`–`CON-CMD-006`. Reuse with different input is a
  conflict, never a new command.
- **SEC-TRANS-011:** The host binds every WebSocket frame to the authenticated socket connection;
  connection identity is transport context and is not a caller-controlled frame field. WebSocket
  ordering is authoritative only for that live connection. Product events, stream data/input and
  other replayable or idempotent frame families carry their contract-specific durable sequence,
  offset or request ID; reconnect never replays an unsequenced transient frame.
- **SEC-TRANS-012:** On event replay gap, client MUST discard affected derived
  authorization and domain views, fetch an authenticated snapshot, then resume
  from its snapshot cursor. Events are not authorization evidence.

TLS already supplies record authenticity on direct connections. The envelope
rules supply application idempotency, explicit audience, and consistency across
reconnects; Acorn MUST NOT invent a second unaudited direct-transport cipher.

## Future opaque relay boundary

Relay support is not a V2 deliverable, but all protocol contracts MUST preserve
these requirements:

- **SEC-TRANS-013:** Relay sessions use
  `Noise_XX_25519_ChaChaPoly_SHA256`. Node and client ephemeral/static Noise
  keys are bound to their Acorn identities by Ed25519 signatures inside the
  authenticated handshake.
- **SEC-TRANS-014:** The pairing-established Node pin and device certificate are
  verified inside the Noise transcript. A relay-provided identity, key, route,
  or downgrade signal is never authoritative.
- **SEC-TRANS-015:** After handshake, each direction uses an independent key,
  64-bit monotonically increasing counter, authenticated routing context, and
  automatic rekey after `2^20` records or one hour, whichever comes first.
- **SEC-TRANS-016:** Relay frames use ChaCha20-Poly1305, maximum 1 MiB plaintext,
  and authenticate session ID, direction, sequence, and protocol major as
  associated data. Counter reuse is fatal.
- **SEC-TRANS-017:** Relay resumption performs a fresh Noise handshake. Session
  keys are memory-only and are never backed up, logged, or exposed to plugins.
- **SEC-TRANS-018:** The relay stores no plaintext, content keys, client
  certificate private keys, Node identity private keys, provider credentials,
  or decrypted metadata.
- **SEC-TRANS-019:** Relay routing identifiers MUST be random, pairwise, and
  rotatable. They MUST NOT be Node IDs, device IDs, GitHub identities, plugin
  IDs, workspace IDs, or email addresses.
- **SEC-TRANS-020:** Relay delivery is untrusted and at-least-once. Endpoints
  reject injection, duplication, reordering outside the receive window, and
  stale session frames.
- **SEC-TRANS-021:** The relay MUST enforce per-session byte, connection, and
  rate quotas without examining plaintext. Endpoint flow control remains
  authoritative.
- **SEC-TRANS-022:** Relay discovery and push payloads contain only opaque wake
  tokens; product content is fetched after end-to-end session establishment.
- **SEC-TRANS-023:** The client UI MUST distinguish direct, relayed, reconnecting,
  and identity-error states without implying that relayed means decrypted.
- **SEC-TRANS-024:** Relay unavailability MUST degrade to offline state, not
  bypass pinning or fall back to plaintext/direct unverified endpoints.
- **SEC-TRANS-025:** Relay metadata exposure—routing token, timing, source IP,
  destination IP, and ciphertext size—is a documented residual risk.
- **SEC-TRANS-026:** Relay envelope encoding is the closed
  `relay-envelope-v2.schema.json`. The Noise prologue and signed transcript
  contain protocol major/suite, both ephemeral Noise keys, Node ID/identity
  key/fingerprint/identity generation/revocation epoch, device ID/certificate
  digest/credential generation/revocation epoch, routing-token digest/
  generation/expiry, relay service identity and both 256-bit nonces.
  `trustContextDigest` is SHA-256 of the RFC 8785 canonical public transcript.
  Both Acorn identities sign it before traffic keys are accepted.
- **SEC-TRANS-027:** Each direction starts sequence zero and maintains
  `highestAuthenticated` plus a 4,096-bit replay bitmap. An authenticated frame
  within the trailing 4,096 positions is accepted once; duplicate or older is
  discarded. A higher frame slides/zeroes the bitmap by the exact delta. A
  jump greater than 4,096 closes the session instead of allocating or
  speculating. Frames are delivered upward only in sequence; a missing frame
  for 30 seconds requests retransmission, and after 60 seconds closes the
  session. Acknowledgements are encrypted control records containing
  `ackThrough` and the trailing bitmap.
- **SEC-TRANS-028:** Sequence cannot exceed `2^63-1`; key epoch increments
  before 1,048,576 records or one hour. Rekey is an encrypted request/
  acknowledgement bound to the old key, new epoch and fresh DH contribution;
  application sending pauses until acknowledgement. Failure or counter/epoch
  wrap closes and performs a fresh full handshake. Reconnect/resume never
  reuses session ID, counters or keys; application event/stream cursors provide
  semantic resumption.
- **SEC-TRANS-029:** A routing token is 256 random bits, pairwise to one Node/
  device tuple, expires within 24 hours, rotates at every handshake and has a
  monotonically increasing generation. Revocation of device, Node identity,
  recovery epoch or route invalidates queued frames and token before a new
  handshake. Relay queues at most 64 MiB or 24 hours per token and drops the
  oldest complete ciphertext frame with an opaque overflow indication.
  Endpoints recheck current credential/identity/revocation generations during
  handshake and at least every 60 seconds; mismatch closes without fallback.
- **SEC-TRANS-030:** Relay delivery cannot be enabled merely because the schema
  exists. A later product release MUST ship the published handshake/envelope/
  replay test vectors and pass `SEC-TEST-TRANS-011` through
  `SEC-TEST-TRANS-012A`; V2 UI/config contains no operational relay toggle.

## Rotation and algorithm agility

Protocol negotiation advertises named suites, but an endpoint MUST select only
a suite allowed by its local minimum-security policy. Unknown or removed suites
fail with `incompatible-security-profile`; they never downgrade silently.
Algorithm removal follows the V2 compatibility and removal process. Identity
rotation and loss behavior are defined in
[identity-pairing-and-authentication.md](./identity-pairing-and-authentication.md).
